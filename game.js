const canvas = document.querySelector("#board");
const ctx = canvas.getContext("2d");

const controls = {
  width: document.querySelector("#gridWidth"),
  height: document.querySelector("#gridHeight"),
  obstacleRate: document.querySelector("#obstacleRate"),
  blueControl: document.querySelector("#blueControl"),
  buildingButtons: [...document.querySelectorAll("[data-building]")],
  newGame: document.querySelector("#newGame"),
  progressBuild: document.querySelector("#progressBuild"),
};

const labels = {
  redScore: document.querySelector("#redScore"),
  blueScore: document.querySelector("#blueScore"),
  turn: document.querySelector("#turnLabel"),
  selected: document.querySelector("#selectedLabel"),
  open: document.querySelector("#openLabel"),
  message: document.querySelector("#message"),
  meta: {
    bar: document.querySelector("#barMeta"),
    cafe: document.querySelector("#cafeMeta"),
    restaurant: document.querySelector("#restaurantMeta"),
    eatery: document.querySelector("#eateryMeta"),
  },
};

const CHAINS = {
  red: { name: "Bun Battalion", color: "#c64538", soft: "rgba(198, 69, 56, 0.22)", ready: "rgba(198, 69, 56, 0.62)" },
  blue: { name: "Griddle Guild", color: "#26758f", soft: "rgba(38, 117, 143, 0.22)", ready: "rgba(38, 117, 143, 0.62)" },
};

const BUILDINGS = {
  bar: { name: "Bar", size: 3, progressNeeded: 0, mark: "B" },
  cafe: { name: "Cafe", size: 4, progressNeeded: 2, mark: "C" },
  restaurant: { name: "Restaurant", size: 5, progressNeeded: 3, mark: "R" },
  eatery: { name: "Eatery", size: 1, progressNeeded: 5, mark: "E" },
};

let state;
let boardBox = { x: 0, y: 0, cell: 1 };
let aiTimer = 0;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function key(x, y) {
  return `${x},${y}`;
}

function emptyBuildMap(value = 0) {
  return { cafe: value, restaurant: value, eatery: value };
}

function newState() {
  const width = clamp(Number(controls.width.value) || 20, 12, 40);
  const height = clamp(Number(controls.height.value) || 20, 12, 40);
  controls.width.value = width;
  controls.height.value = height;

  const owners = new Map();
  const obstacles = new Set();
  seedCornerTerritory(owners, width, height);

  const obstacleTarget = Math.floor(width * height * Number(controls.obstacleRate.value));
  let guard = 0;
  while (obstacles.size < obstacleTarget && guard < width * height * 10) {
    guard += 1;
    const x = Math.floor(Math.random() * width);
    const y = Math.floor(Math.random() * height);
    const tileKey = key(x, y);
    if (!owners.has(tileKey)) obstacles.add(tileKey);
  }

  return {
    width,
    height,
    owners,
    obstacles,
    turn: "red",
    selected: { red: "bar", blue: "bar" },
    inventory: { red: emptyBuildMap(), blue: emptyBuildMap() },
    progress: { red: emptyBuildMap(), blue: emptyBuildMap() },
    placement: null,
    gameOver: false,
    aiTeam: controls.blueControl.value === "computer" ? "blue" : null,
    turnNumber: 1,
    hover: null,
  };
}

function seedCornerTerritory(owners, width, height) {
  for (let y = 0; y < 3; y += 1) {
    for (let x = 0; x < 3; x += 1) {
      owners.set(key(x, y), "red");
      owners.set(key(width - 1 - x, height - 1 - y), "blue");
    }
  }
}

function inside(x, y) {
  return x >= 0 && y >= 0 && x < state.width && y < state.height;
}

function footprintCells(centerX, centerY, buildingKey, orientation = 0) {
  if (buildingKey === "eatery") return [{ x: centerX, y: centerY }];
  if (buildingKey === "cafe") return cafeFootprint(centerX, centerY, orientation);

  const building = BUILDINGS[buildingKey];
  const span = Math.floor(building.size / 2);
  const cells = [];
  for (let y = centerY - span; y <= centerY + span; y += 1) {
    for (let x = centerX - span; x <= centerX + span; x += 1) {
      cells.push({ x, y });
    }
  }
  return cells;
}

function cafeFootprint(x, y, orientation) {
  const offsets = [
    { left: 1, top: 1 },
    { left: 2, top: 1 },
    { left: 2, top: 2 },
    { left: 1, top: 2 },
  ][orientation % 4];
  const cells = [];
  for (let cy = y - offsets.top; cy < y - offsets.top + 4; cy += 1) {
    for (let cx = x - offsets.left; cx < x - offsets.left + 4; cx += 1) {
      cells.push({ x: cx, y: cy });
    }
  }
  return cells;
}

function cafeFootprintFromDiagonal(first, second) {
  const minX = Math.min(first.x, second.x);
  const minY = Math.min(first.y, second.y);
  const cells = [];
  for (let y = minY - 1; y <= minY + 2; y += 1) {
    for (let x = minX - 1; x <= minX + 2; x += 1) {
      cells.push({ x, y });
    }
  }
  return cells;
}

function cafeCenterCellsFromDiagonal(first, second) {
  const minX = Math.min(first.x, second.x);
  const minY = Math.min(first.y, second.y);
  return [
    { x: minX, y: minY },
    { x: minX + 1, y: minY },
    { x: minX, y: minY + 1 },
    { x: minX + 1, y: minY + 1 },
  ];
}

function validCafeDiagonal(first, second) {
  return Math.abs(first.x - second.x) === 1 && Math.abs(first.y - second.y) === 1;
}

function canPlace(team, x, y, buildingKey, orientation = 0) {
  if (!inside(x, y)) return { ok: false, reason: "That point is outside the grid." };
  const building = BUILDINGS[buildingKey];

  if (building.size > 1 && state.owners.get(key(x, y)) !== team) {
    return { ok: false, reason: `${building.name} must pin its center on your shaded territory.` };
  }

  let gains = 0;
  for (const cell of footprintCells(x, y, buildingKey, orientation)) {
    if (!inside(cell.x, cell.y)) continue;
    const tileKey = key(cell.x, cell.y);
    if (!state.obstacles.has(tileKey) && !state.owners.has(tileKey)) gains += 1;
  }

  if (gains === 0) return { ok: false, reason: "That would not claim any scoreable tiles." };
  return { ok: true, gains };
}

function canPlaceCafeDiagonal(team, first, second) {
  if (!validCafeDiagonal(first, second)) {
    return { ok: false, reason: "Cafe needs two diagonal middle tiles, one tile apart." };
  }

  if (!cafeCenterCellsFromDiagonal(first, second).some((cell) => state.owners.get(key(cell.x, cell.y)) === team)) {
    return { ok: false, reason: "Cafe's central 2x2 must touch your shaded territory." };
  }

  let gains = 0;
  for (const cell of cafeFootprintFromDiagonal(first, second)) {
    if (!inside(cell.x, cell.y)) continue;
    const tileKey = key(cell.x, cell.y);
    if (!state.obstacles.has(tileKey) && !state.owners.has(tileKey)) gains += 1;
  }

  if (gains === 0) return { ok: false, reason: "That cafe would not claim any scoreable tiles." };
  return { ok: true, gains };
}

function readyCount(team, buildingKey) {
  return buildingKey === "bar" ? Infinity : state.inventory[team][buildingKey];
}

function hasReadyBuilding(team, buildingKey) {
  return buildingKey === "bar" || state.inventory[team][buildingKey] > 0;
}

function progressSelected() {
  if (state.gameOver || state.turn === state.aiTeam) return;
  state.placement = null;
  progressBuilding(state.turn, currentSelected());
}

function progressBuilding(team, buildingKey) {
  if (buildingKey === "bar") {
    labels.message.textContent = "Bars are always ready. Place one on the board instead.";
    updateStatus();
    draw();
    return false;
  }

  state.progress[team][buildingKey] += 1;
  const needed = BUILDINGS[buildingKey].progressNeeded;
  if (state.progress[team][buildingKey] >= needed) {
    state.progress[team][buildingKey] = 0;
    state.inventory[team][buildingKey] += 1;
    labels.message.textContent = `${CHAINS[team].name} finished a ${BUILDINGS[buildingKey].name}.`;
  } else {
    labels.message.textContent = `${CHAINS[team].name} worked on a ${BUILDINGS[buildingKey].name}.`;
  }

  finishTurn();
  return true;
}

function requestPlacement(x, y) {
  if (state.gameOver || state.turn === state.aiTeam) return;
  const buildingKey = currentSelected();

  if (!hasReadyBuilding(state.turn, buildingKey)) {
    labels.message.textContent = `No ${BUILDINGS[buildingKey].name} is ready. Progress it first.`;
    updateStatus();
    draw();
    return;
  }

  if (buildingKey === "cafe") {
    if (!state.placement || state.placement.building !== "cafe") {
      state.placement = { building: "cafe", first: { x, y } };
      labels.message.textContent = "Cafe middle tile chosen. Click a diagonal neighbor to define the 2x2 center.";
      updateStatus();
      draw();
      return;
    }

    if (state.placement.first.x === x && state.placement.first.y === y) {
      state.placement = null;
      labels.message.textContent = "Cafe placement canceled. Choose another building or click a new middle tile.";
      updateStatus();
      draw();
      return;
    }

    placeCafeByDiagonal(state.turn, state.placement.first, { x, y });
    return;
  }

  placeBuilding(state.turn, buildingKey, x, y, 0);
}

function placeBuilding(team, buildingKey, x, y, orientation) {
  const legality = canPlace(team, x, y, buildingKey, orientation);
  if (!legality.ok) {
    labels.message.textContent = legality.reason;
    updateStatus();
    draw();
    return false;
  }

  claimFootprint(team, x, y, buildingKey, orientation);
  if (buildingKey !== "bar") state.inventory[team][buildingKey] -= 1;
  state.placement = null;
  labels.message.textContent = `${CHAINS[team].name} placed a ${BUILDINGS[buildingKey].name}.`;
  finishTurn();
  return true;
}

function placeCafeByDiagonal(team, first, second) {
  const legality = canPlaceCafeDiagonal(team, first, second);
  if (!legality.ok) {
    labels.message.textContent = legality.reason;
    updateStatus();
    draw();
    return false;
  }

  for (const cell of cafeFootprintFromDiagonal(first, second)) {
    if (!inside(cell.x, cell.y)) continue;
    const tileKey = key(cell.x, cell.y);
    if (!state.obstacles.has(tileKey) && !state.owners.has(tileKey)) state.owners.set(tileKey, team);
  }
  state.inventory[team].cafe -= 1;
  state.placement = null;
  labels.message.textContent = `${CHAINS[team].name} placed a Cafe.`;
  finishTurn();
  return true;
}

function claimFootprint(team, x, y, buildingKey, orientation) {
  for (const cell of footprintCells(x, y, buildingKey, orientation)) {
    if (!inside(cell.x, cell.y)) continue;
    const tileKey = key(cell.x, cell.y);
    if (!state.obstacles.has(tileKey) && !state.owners.has(tileKey)) state.owners.set(tileKey, team);
  }
}

function finishTurn() {
  if (checkGameOver()) {
    updateStatus();
    draw();
    return;
  }

  state.turn = state.turn === "red" ? "blue" : "red";
  state.placement = null;
  if (state.turn === "red") state.turnNumber += 1;
  if (!checkGameOver()) scheduleComputerMove();
  updateStatus();
  draw();
}

function hasAnyLegalMove(team) {
  for (const buildingKey of Object.keys(BUILDINGS)) {
    if (!hasReadyBuilding(team, buildingKey)) continue;
    for (let y = 0; y < state.height; y += 1) {
      for (let x = 0; x < state.width; x += 1) {
        if (buildingKey === "cafe") {
          for (const diagonal of cafeDiagonalsFromTile(x, y)) {
            if (canPlaceCafeDiagonal(team, diagonal.first, diagonal.second).ok) return true;
          }
        } else if (canPlace(team, x, y, buildingKey).ok) {
          return true;
        }
      }
    }
  }
  return false;
}

function checkGameOver() {
  const open = openTiles();
  if (open > 0) return false;
  state.gameOver = true;
  labels.message.textContent = winnerMessage("The grid is full.");
  return true;
}

function winnerMessage(prefix) {
  const red = scoreFor("red");
  const blue = scoreFor("blue");
  if (red === blue) return `${prefix} The chains tied at ${red} tiles each.`;
  const winner = red > blue ? "red" : "blue";
  return `${prefix} ${CHAINS[winner].name} wins ${Math.max(red, blue)} to ${Math.min(red, blue)}.`;
}

function scoreFor(team) {
  let total = 0;
  for (const owner of state.owners.values()) {
    if (owner === team) total += 1;
  }
  return total;
}

function openTiles() {
  return state.width * state.height - state.obstacles.size - state.owners.size;
}

function tileFromEvent(event) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const px = (event.clientX - rect.left) * scaleX;
  const py = (event.clientY - rect.top) * scaleY;
  const x = Math.floor((px - boardBox.x) / boardBox.cell);
  const y = Math.floor((py - boardBox.y) / boardBox.cell);
  if (!inside(x, y)) return null;
  return { x, y };
}

function draw() {
  resizeCanvas();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawPaper();
  drawTerritory();
  drawObstacles();
  drawHover();
  drawCafeFirstCorner();
  drawGrid();
  drawCorners();
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(320, Math.floor(rect.width * dpr));
  const height = Math.max(320, Math.floor(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  const pad = Math.max(18 * dpr, Math.min(width, height) * 0.035);
  const usable = Math.min(width - pad * 2, height - pad * 2);
  const cell = Math.floor(usable / Math.max(state.width, state.height));
  boardBox = {
    x: Math.round((width - state.width * cell) / 2),
    y: Math.round((height - state.height * cell) / 2),
    cell,
  };
}

function drawPaper() {
  ctx.fillStyle = "#fbfaf3";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#e5dec7";
  ctx.font = `${Math.max(13, boardBox.cell * 0.32)}px ui-sans-serif, system-ui`;
  ctx.fillText(`Turn ${state.turnNumber}`, boardBox.x, Math.max(20, boardBox.y - 12));
}

function drawTerritory() {
  for (const [tileKey, team] of state.owners.entries()) {
    const [x, y] = tileKey.split(",").map(Number);
    fillCell(x, y, CHAINS[team].ready);
  }
}

function drawObstacles() {
  ctx.fillStyle = "#596158";
  for (const tileKey of state.obstacles) {
    const [x, y] = tileKey.split(",").map(Number);
    roundedCell(x, y, 0.14);
    ctx.fill();
  }
}

function drawHover() {
  if (state.gameOver || state.turn === state.aiTeam) return;
  const selected = currentSelected();
  if (selected === "cafe" && !state.placement) return;
  const preview = cafePreview() || (state.hover && { building: selected, x: state.hover.x, y: state.hover.y, orientation: 0 });
  if (!preview) return;

  if (!hasReadyBuilding(state.turn, preview.building)) return;

  const legality = preview.building === "cafe" && preview.second
    ? canPlaceCafeDiagonal(state.turn, preview.first, preview.second)
    : canPlace(state.turn, preview.x, preview.y, preview.building, preview.orientation);
  const team = CHAINS[state.turn];
  ctx.fillStyle = legality.ok ? team.soft : "rgba(52, 55, 48, 0.13)";
  const cells = preview.building === "cafe" && preview.second
    ? cafeFootprintFromDiagonal(preview.first, preview.second)
    : footprintCells(preview.x, preview.y, preview.building, preview.orientation);
  for (const cell of cells) {
    if (inside(cell.x, cell.y)) fillCell(cell.x, cell.y, ctx.fillStyle);
  }

  ctx.strokeStyle = legality.ok ? team.color : "#6e726a";
  ctx.lineWidth = Math.max(2, boardBox.cell * 0.08);
  if (preview.building === "cafe" && preview.second) {
    strokeCells(cells);
  } else {
    strokeFootprint(preview.x, preview.y, preview.building, preview.orientation);
  }
}

function cafePreview() {
  if (!state.placement || state.placement.building !== "cafe" || !state.hover) return null;
  return { building: "cafe", first: state.placement.first, second: state.hover };
}

function drawCafeFirstCorner() {
  if (!state.placement || state.placement.building !== "cafe") return;
  ctx.fillStyle = "#fffef8";
  ctx.strokeStyle = CHAINS[state.turn].color;
  ctx.lineWidth = Math.max(2, boardBox.cell * 0.08);
  const radius = boardBox.cell * 0.22;
  ctx.beginPath();
  ctx.arc(cellCenterX(state.placement.first.x), cellCenterY(state.placement.first.y), radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function drawGrid() {
  ctx.strokeStyle = "#cad2c3";
  ctx.lineWidth = Math.max(1, Math.floor(boardBox.cell * 0.04));
  ctx.beginPath();
  for (let x = 0; x <= state.width; x += 1) {
    const px = boardBox.x + x * boardBox.cell;
    ctx.moveTo(px, boardBox.y);
    ctx.lineTo(px, boardBox.y + state.height * boardBox.cell);
  }
  for (let y = 0; y <= state.height; y += 1) {
    const py = boardBox.y + y * boardBox.cell;
    ctx.moveTo(boardBox.x, py);
    ctx.lineTo(boardBox.x + state.width * boardBox.cell, py);
  }
  ctx.stroke();

  ctx.strokeStyle = "#99a48e";
  ctx.lineWidth = Math.max(2, Math.floor(boardBox.cell * 0.06));
  ctx.strokeRect(boardBox.x, boardBox.y, state.width * boardBox.cell, state.height * boardBox.cell);
}

function drawCorners() {
  ctx.lineWidth = Math.max(3, boardBox.cell * 0.12);
  ctx.strokeStyle = CHAINS.red.color;
  ctx.strokeRect(boardBox.x, boardBox.y, boardBox.cell * 3, boardBox.cell * 3);
  ctx.strokeStyle = CHAINS.blue.color;
  ctx.strokeRect(
    boardBox.x + (state.width - 3) * boardBox.cell,
    boardBox.y + (state.height - 3) * boardBox.cell,
    boardBox.cell * 3,
    boardBox.cell * 3
  );
}

function fillCell(x, y, color) {
  ctx.fillStyle = color;
  ctx.fillRect(boardBox.x + x * boardBox.cell + 1, boardBox.y + y * boardBox.cell + 1, boardBox.cell - 2, boardBox.cell - 2);
}

function roundedCell(x, y, insetRatio) {
  const inset = boardBox.cell * insetRatio;
  const px = boardBox.x + x * boardBox.cell + inset;
  const py = boardBox.y + y * boardBox.cell + inset;
  const size = boardBox.cell - inset * 2;
  const radius = Math.max(2, boardBox.cell * 0.12);
  ctx.beginPath();
  ctx.roundRect(px, py, size, size, radius);
}

function strokeFootprint(x, y, buildingKey, orientation) {
  const cells = footprintCells(x, y, buildingKey, orientation).filter((cell) => inside(cell.x, cell.y));
  if (cells.length === 0) return;
  const minX = Math.min(...cells.map((cell) => cell.x));
  const maxX = Math.max(...cells.map((cell) => cell.x));
  const minY = Math.min(...cells.map((cell) => cell.y));
  const maxY = Math.max(...cells.map((cell) => cell.y));
  ctx.strokeRect(
    boardBox.x + minX * boardBox.cell,
    boardBox.y + minY * boardBox.cell,
    (maxX - minX + 1) * boardBox.cell,
    (maxY - minY + 1) * boardBox.cell
  );
}

function strokeCells(cells) {
  const insideCells = cells.filter((cell) => inside(cell.x, cell.y));
  if (insideCells.length === 0) return;
  const minX = Math.min(...insideCells.map((cell) => cell.x));
  const maxX = Math.max(...insideCells.map((cell) => cell.x));
  const minY = Math.min(...insideCells.map((cell) => cell.y));
  const maxY = Math.max(...insideCells.map((cell) => cell.y));
  ctx.strokeRect(
    boardBox.x + minX * boardBox.cell,
    boardBox.y + minY * boardBox.cell,
    (maxX - minX + 1) * boardBox.cell,
    (maxY - minY + 1) * boardBox.cell
  );
}

function cellCenterX(x) {
  return boardBox.x + x * boardBox.cell + boardBox.cell / 2;
}

function cellCenterY(y) {
  return boardBox.y + y * boardBox.cell + boardBox.cell / 2;
}

function updateStatus() {
  labels.redScore.textContent = scoreFor("red");
  labels.blueScore.textContent = scoreFor("blue");
  labels.turn.textContent = state.gameOver ? "Game over" : CHAINS[state.turn].name;
  labels.selected.textContent = selectedSummary();
  labels.open.textContent = openTiles();
  controls.progressBuild.disabled = state.gameOver || state.turn === state.aiTeam || currentSelected() === "bar";
  updateBuildingButtons();
}

function selectedSummary() {
  const buildingKey = currentSelected();
  if (buildingKey === "bar") return "Bar, always ready";
  const ready = state.inventory[state.turn][buildingKey];
  const progress = state.progress[state.turn][buildingKey];
  const needed = BUILDINGS[buildingKey].progressNeeded;
  return `${BUILDINGS[buildingKey].name}, ${ready} ready, ${progress}/${needed}`;
}

function updateBuildingButtons() {
  for (const button of controls.buildingButtons) {
    const buildingKey = button.dataset.building;
    const selected = buildingKey === currentSelected();
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));

    if (buildingKey === "bar") {
      labels.meta.bar.textContent = "Ready";
    } else {
      labels.meta[buildingKey].textContent = `${state.inventory[state.turn][buildingKey]} ready ${state.progress[state.turn][buildingKey]}/${BUILDINGS[buildingKey].progressNeeded}`;
    }
  }
}

function currentSelected() {
  return state.selected[state.turn];
}

function setCurrentSelected(buildingKey) {
  state.selected[state.turn] = buildingKey;
}

function scheduleComputerMove() {
  clearTimeout(aiTimer);
  if (state.gameOver || state.turn !== state.aiTeam) return;
  labels.message.textContent = `${CHAINS[state.turn].name} is choosing.`;
  aiTimer = setTimeout(playComputerMove, 420);
}

function playComputerMove() {
  if (state.gameOver || state.turn !== state.aiTeam) return;
  const moves = legalComputerPlacements();
  if (moves.length > 0) {
    moves.sort((a, b) => b.score - a.score);
    const pick = moves[Math.floor(Math.random() * Math.min(5, moves.length))];
    setCurrentSelected(pick.buildingKey);
    if (pick.buildingKey === "cafe") {
      placeCafeByDiagonal(state.turn, pick.first, pick.second);
    } else {
      placeBuilding(state.turn, pick.buildingKey, pick.x, pick.y, pick.orientation);
    }
    return;
  }

  const buildable = ["cafe", "restaurant", "eatery"];
  const target = buildable[Math.floor(Math.random() * buildable.length)];
  setCurrentSelected(target);
  progressBuilding(state.turn, target);
}

function legalComputerPlacements() {
  const moves = [];
  for (const buildingKey of Object.keys(BUILDINGS)) {
    if (!hasReadyBuilding(state.turn, buildingKey)) continue;
    for (let y = 0; y < state.height; y += 1) {
      for (let x = 0; x < state.width; x += 1) {
        if (buildingKey === "cafe") {
          for (const diagonal of cafeDiagonalsFromTile(x, y)) {
            const legality = canPlaceCafeDiagonal(state.turn, diagonal.first, diagonal.second);
            if (legality.ok) {
              moves.push({
                buildingKey,
                first: diagonal.first,
                second: diagonal.second,
                score: aiScoreForCells(cafeFootprintFromDiagonal(diagonal.first, diagonal.second), legality.gains),
              });
            }
          }
        } else {
          const legality = canPlace(state.turn, x, y, buildingKey, 0);
          if (legality.ok) {
            moves.push({ x, y, buildingKey, orientation: 0, score: aiScore(x, y, buildingKey, 0, legality.gains) });
          }
        }
      }
    }
  }
  return moves;
}

function cafeDiagonalsFromTile(x, y) {
  return [
    { first: { x, y }, second: { x: x + 1, y: y + 1 } },
    { first: { x, y }, second: { x: x + 1, y: y - 1 } },
    { first: { x, y }, second: { x: x - 1, y: y + 1 } },
    { first: { x, y }, second: { x: x - 1, y: y - 1 } },
  ].filter((diagonal) => inside(diagonal.second.x, diagonal.second.y));
}

function aiScore(x, y, buildingKey, orientation, gains) {
  return aiScoreForCells(footprintCells(x, y, buildingKey, orientation), gains);
}

function aiScoreForCells(cells, gains) {
  const enemy = state.turn === "red" ? "blue" : "red";
  let pressure = 0;
  for (const cell of cells) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (state.owners.get(key(cell.x + dx, cell.y + dy)) === enemy) pressure += 0.4;
      }
    }
  }
  const x = cells.reduce((sum, cell) => sum + cell.x, 0) / cells.length;
  const y = cells.reduce((sum, cell) => sum + cell.y, 0) / cells.length;
  const centerPull = 1 / (1 + Math.abs(x - state.width / 2) + Math.abs(y - state.height / 2));
  return gains * 4 + pressure + centerPull + Math.random();
}

function setupEvents() {
  controls.newGame.addEventListener("click", startGame);
  controls.progressBuild.addEventListener("click", progressSelected);

  for (const button of controls.buildingButtons) {
    button.addEventListener("click", () => {
      setCurrentSelected(button.dataset.building);
      state.placement = null;
      updateStatus();
      draw();
    });
  }

  controls.blueControl.addEventListener("change", startGame);

  canvas.addEventListener("click", (event) => {
    const tile = tileFromEvent(event);
    if (!tile) return;
    requestPlacement(tile.x, tile.y);
  });

  canvas.addEventListener("mousemove", (event) => {
    state.hover = tileFromEvent(event);
    draw();
  });

  canvas.addEventListener("mouseleave", () => {
    state.hover = null;
    draw();
  });

  window.addEventListener("resize", draw);
}

function startGame() {
  clearTimeout(aiTimer);
  state = newState();
  labels.message.textContent = "Place a ready building, or progress the selected one.";
  updateStatus();
  draw();
  scheduleComputerMove();
}

if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function roundRect(x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    this.moveTo(x + r, y);
    this.arcTo(x + width, y, x + width, y + height, r);
    this.arcTo(x + width, y + height, x, y + height, r);
    this.arcTo(x, y + height, x, y, r);
    this.arcTo(x, y, x + width, y, r);
    this.closePath();
  };
}

setupEvents();
startGame();
