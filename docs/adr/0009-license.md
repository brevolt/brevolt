# ADR-0009: License: MIT or AGPL-3.0

- Status: Proposed (decision pending: @raul)
- Date: 2026-11-16
- Spike reports: none

## Context

Brevolt is open source and self-hosted. The license must be chosen before the first release (spec: "MIT or AGPL-3.0, to be decided in BRV-004"). No decision has been recorded yet.

## Decision

**Pending @raul.** Two options:

- **MIT**: maximal adoption and simplicity; anyone, including hosted competitors, can reuse the code without sharing changes.
- **AGPL-3.0**: network copyleft; modified versions offered as a service must publish their source. Protects against closed hosted forks but may deter some contributors and companies; the Obsidian plugin and a Swift bridge distributed to users need consideration of how copyleft applies to each.

No recommendation is made on product grounds. Update this ADR to `Accepted` with the chosen option.

## Alternatives considered

- Dual license or other licenses (Apache-2.0, GPL-3.0): not on the list in the spec; can be added if @raul wants them.

## Consequences

- BRV-010 needs the `LICENSE` file; it can start with this ADR still Proposed only if @raul accepts adding the license later, otherwise this blocks that file.
