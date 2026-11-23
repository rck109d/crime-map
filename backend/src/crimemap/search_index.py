"""Address ids and the web map's place-search index, built from the archive.

Every address APD has published an incident at gets a small integer id, which
each row of the site's incident table carries. The search index lists those
addresses so the map's search needs no outside geocoding service:

    streets    each street name, with the house numbers that have incidents,
               where they are, and their ids
    crossings  intersections and other addresses without a house number
"""

from __future__ import annotations

import re
from collections import Counter

# "3393 PEACHTREE RD NE" -> house number and street name.
HOUSE_NUMBER = re.compile(r"^(\d{1,7})\s+(\S.*)$")
# Placeholders APD uses when it has no address. They share id 0, "no address".
NOT_AN_ADDRESS = {"", "N/A", "NA", "UNKNOWN", "NONE"}
NO_ADDRESS_ID = 0


def clean_address(address: str) -> str:
    """Collapse the stray double spaces that appear in the source."""
    return " ".join(address.split())


def number_addresses(counts: Counter[str]) -> dict[str, int]:
    """Give each address an id: 1 for the busiest, counting up; 0 for placeholders.

    Busy addresses getting small numbers keeps the ids compact when stored.
    """
    ids: dict[str, int] = {}
    real = [a for a in counts if a.upper() not in NOT_AN_ADDRESS]
    for rank, address in enumerate(sorted(real, key=lambda a: (-counts[a], a)), start=1):
        ids[address] = rank
    for address in counts:
        ids.setdefault(address, NO_ADDRESS_ID)
    return ids


def build_search_index(places: dict[str, tuple[int, int, int]], counts: Counter[str]) -> dict:
    """`places` maps an address to (id, x, y): its id and current map position."""
    streets: dict[str, list[tuple[int, int, int, int, int]]] = {}
    crossings: list[list] = []
    for address in sorted(places):
        address_id, x, y = places[address]
        count = counts[address]
        match = HOUSE_NUMBER.match(address)
        if match:
            streets.setdefault(match.group(2), []).append(
                (int(match.group(1)), x, y, count, address_id)
            )
        else:
            crossings.append([address, x, y, count, address_id])

    street_list = []
    for name, addresses in streets.items():
        addresses.sort()
        street_list.append(
            {
                "n": name,
                "c": sum(a[3] for a in addresses),
                # Flat [number, x, y, incidents, id, ...] to keep the file small.
                "a": [value for a in addresses for value in a],
            }
        )
    street_list.sort(key=lambda s: (-s["c"], s["n"]))
    crossings.sort(key=lambda c: (-c[3], c[0]))
    return {"streets": street_list, "crossings": crossings}
