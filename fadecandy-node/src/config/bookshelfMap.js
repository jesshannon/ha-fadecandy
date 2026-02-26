// Mapping from bookshelf columns/shelves to physical LED index ranges.
// Columns are 0-based from left to right; shelves are 0-based from top to bottom.
// Each shelf maps to one or more inclusive index ranges on the strip.
export const BOOKSHELF_MAP = [
  [
    [[49, 56], [112, 119]],
    [[39, 47], [103, 110]],
    [[29, 37], [92, 101]],
    [[19, 27], [83, 90]],
    [[10, 17], [74, 81]],
    [[0, 8], [64, 72]],
  ],
  [
    [[177, 184], [241, 248]],
    [[167, 175], [231, 239]],
    [[157, 165], [221, 229]],
    [[147, 155], [211, 219]],
    [[138, 145], [202, 209]],
    [[128, 137], [192, 201]],
  ],
  [
    [[304, 311], [369, 376]],
    [[295, 303], [359, 367]],
    [[284, 293], [348, 357]],
    [[275, 283], [339, 347]],
    [[266, 273], [330, 337]],
    [[256, 264], [320, 328]],
  ],
];

export function getShelfRanges(columnIndex, shelfIndex, map = BOOKSHELF_MAP) {
  if (!map[columnIndex] || !map[columnIndex][shelfIndex]) return [];
  return map[columnIndex][shelfIndex];
}

export function listShelves(map = BOOKSHELF_MAP) {
  // return a flat list of all shelf entries with coordinates and ranges
  return map.flatMap((column, columnIndex) =>
    column.map((ranges, shelfIndex) => ({
      columnIndex,
      shelfIndex,
      ranges,
    })),
  );
}

export function maxPixelIndex(map = BOOKSHELF_MAP) {
  return map
    .flat(2)
    .reduce((max, range) => Math.max(max, range[1]), 0);
}
