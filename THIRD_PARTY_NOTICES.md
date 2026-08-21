# Third-party notices

This repository combines original trainer code with a small, auditable set of
third-party facts and assets. The project license does not override the rights
or license terms of those materials.

## SimulationCraft

The files under `vendor/simc/` are a minimal snapshot used as an implementation
reference, data-generation input, and validation oracle for the Feral Druid
trainer. SimulationCraft is copyright its contributors and is distributed
under GNU GPL v3, with additional third-party components covered by the license
files retained in `vendor/simc/`.

- Upstream: <https://github.com/simulationcraft/simc>
- Upstream license: `vendor/simc/COPYING`
- Additional upstream licenses: `vendor/simc/LICENSE*`
- Exact local snapshot and SHA-256 values: `versions/simc.lock.json`
- Upstream-diff review evidence: `versions/simc-update-reviews/`

The local snapshot is deliberately described as a `mixed` snapshot with a
`partial-source-match`; it is not represented as an unmodified checkout of a
single upstream commit. The repository does not publish the locally built SimC
binary, object files, or unrelated source trees.

## Blizzard Entertainment / World of Warcraft

World of Warcraft, Warcraft, Blizzard Entertainment, associated names and
logos, spell/talent/item names, game data, and icon artwork are trademarks or
copyrighted works of Blizzard Entertainment, Inc. or its affiliates.

The files in `demo/assets/icons/` are not covered by this repository's GPL
license. They are retained only to identify in-game abilities and effects in a
non-commercial fan-made training tool. No ownership, endorsement, affiliation,
or additional permission is claimed or granted. Downstream distributors are
responsible for confirming that their use and redistribution comply with the
then-current Blizzard policies and applicable law; they may remove or replace
these assets without changing the trainer engine.

Official legal references:

- <https://www.blizzard.com/legal/>
- <https://www.blizzard.com/en-us/legal/c1ae32ac-7ff9-4ac3-a03b-fc04b8697010/blizzard-legal-faq>
- <https://www.blizzard.com/en-us/legal/38fd0408-8431-469a-99bc-2cd9eb9462c8/blizzard-entertainment-trademark-usage-guidelines>

This project is not affiliated with, sponsored by, or endorsed by Blizzard
Entertainment. It is not a substitute for World of Warcraft or SimulationCraft
and does not emulate Blizzard network protocols.

## User-provided profiles

Imported `/simc` profile text is parsed locally in the browser. The project
does not require a hosted account service and does not transmit imported
profiles to a project-controlled backend. Users should still remove character
names or other personal information before sharing profiles in issues.
