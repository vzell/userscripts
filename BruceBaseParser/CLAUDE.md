# CLAUDE.md — BruceBase parser context

The BruceBase website at http://brucebase.wikidot.com/ renders everything related to Bruce Springsteen in a highly
structured but HTML generated oriented way.

The goal of this userscript is, it will parse different aspects from the underlying HTML data and checks for
inconsistencies, by enriching the standard BrueBase pages with glyphs which shows discrepancies between different parts
of the website.

We will start with the generic YEAR event pages and check if the corresponding event DETAILS pages match with their
event names.

The URL structure for YEAR pages is

#+begin_example
http://brucebase.wikidot.com/<4 digit year>
#+end_example

e.g. "http://brucebase.wikidot.com/2024"

Typical event name looks like (in all UPPERCAE and a "-" between the date and venue) and hyperlinked to their event
DETAIL page (Capitalized and "The" inside "(" and ") before the ",") in

| YEAR page (event name)                             | Anchor in YEAR page   | Link                                                                          | DETAIL page (event name)                                       |
|----------------------------------------------------+-----------------------+-------------------------------------------------------------------------------+----------------------------------------------------|
| 2024-01-07 - THE BEVERLY HILTON, BEVERLY HILLS, CA | <a name="070124"></a> | http://brucebase.wikidot.com/nogig:2024-01-07-beverly-hilton-beverly-hills-ca | 2024-01-07 Beverly Hilton (The), Beverly Hills, CA |
| 2024-01-19 - FIVE RINGS FARM, WELLINGTON, FL       | <a name="190124"></a> | http://brucebase.wikidot.com/gig:2024-01-19-five-rings-farm-wellington-fl     | 2024-01-19 Five Rings Farm, Wellington, FL         |
|                                                    |                       |                                                                               |                                                    |

Write a userscript which parses the YEAR pages, and for each event follows the link to the detail page and compares the
event names. For the comparison to succeed

- the "(The)" in front of a "," should be treated as being right after the date (which additionally should get a " - " added)
- the comparison should be made by UPCASING the DETAILpage evetn name
 
So e.g the two event names in the above table should be considered the same. In this case append a green checkmark after
the event name on the YEAR page and a red cross if they differ.

In both cases when hovering over the YEAR page event name, display in a rich HTML based tooltip the differences (if any)
in the event name (except if they differ in what we already discussed)
