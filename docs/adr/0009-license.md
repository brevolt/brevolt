# ADR-0009: License: MIT or AGPL-3.0

- Status: Accepted (decided by @raul: AGPL-3.0)
- Date: 2026-11-16
- Spike reports: none

## Context

Brevolt is open source and self-hosted. The license must be chosen before the first release (spec: "MIT or AGPL-3.0, to be decided in BRV-004"). No decision has been recorded yet.

## Decision

**AGPL-3.0**, chosen by @raul. Options considered:

- **MIT**: maximal adoption and simplicity; anyone, including hosted competitors, can reuse the code without sharing changes.
- **AGPL-3.0**: network copyleft; modified versions offered as a service must publish their source. Protects against closed hosted forks but may deter some contributors and companies; the Obsidian plugin and a Swift bridge distributed to users need consideration of how copyleft applies to each.

The `LICENSE` file at the repository root carries the AGPL-3.0 text.

## Alternatives considered

- Dual license or other licenses (Apache-2.0, GPL-3.0): not on the list in the spec; can be added if @raul wants them.

## Consequences

- Hosted forks must publish their modifications. How copyleft applies to the Obsidian plugin and the Swift bridge distributed to users should be revisited before release.
