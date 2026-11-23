"""Outlines of areas, drawn around the incidents recorded in them.

APD publishes each incident's neighborhood, NPU and zone, but the archive has
no boundary files. An area's incidents all lie inside it, so the convex hull of
their positions is a fair sketch of where the area is: good enough to frame it
on the map and show roughly what it covers, though not its official boundary.
"""

from __future__ import annotations

from collections.abc import Iterable

Point = tuple[int, int]


def convex_hull(points: Iterable[Point]) -> list[Point]:
    """Corners of the smallest convex shape containing `points`, counter-clockwise.

    Andrew's monotone chain. Fewer than three distinct points, or points all on
    one line, come back as they are (one or two points).
    """
    pts = sorted(set(points))
    if len(pts) <= 2:
        return pts

    def cross(o: Point, a: Point, b: Point) -> int:
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower: list[Point] = []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper: list[Point] = []
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def outlines(positions: dict[int, set[Point]], size: int) -> list[list[int] | None]:
    """One flat [x0, y0, x1, y1, ...] outline per id, or None where nothing is mapped."""
    out: list[list[int] | None] = []
    for area_id in range(size):
        found = positions.get(area_id)
        if not found:
            out.append(None)
            continue
        out.append([value for point in convex_hull(found) for value in point])
    return out
