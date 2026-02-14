# Homunculus Jira CSV Import Guide

## Files

- Main import file: `/Users/joexu/Repos/Homunculus/docs/homunculus-jira-import.csv`

## Recommended Jira field mapping

Map CSV columns to Jira fields as follows:

| CSV Column | Jira Field |
|---|---|
| `Issue ID` | External issue id (or keep as text/custom field if not available) |
| `Issue Type` | Issue Type |
| `Summary` | Summary |
| `Description` | Description |
| `Priority` | Priority |
| `Labels` | Labels |
| `Components` | Component/s |
| `Epic Name` | Epic Name (for Epic rows only) |
| `Epic Link` | Epic Link (for Task rows) |
| `Story Points` | Story points (or your estimation field) |
| `Original Estimate` | Original estimate |
| `Depends On` | Custom text field (`Depends On`) or map into Description |
| `Acceptance Criteria` | Custom text field (`Acceptance Criteria`) or Description |
| `Technical Notes` | Custom text field (`Technical Notes`) or Description |

## Import order

1. Import all rows from the CSV in one pass.
2. Confirm epics are created with `Epic Name` values:
   - `HM-PH1-MVP`
   - `HM-PH2-HARDEN`
   - `HM-PH3-EXTEND`
3. Verify task rows are linked to epics through `Epic Link`.

## Compatibility note

- Some Jira projects use `Parent` instead of `Epic Link` for hierarchy. If your importer does not expose `Epic Link`, remap `Epic Link` values to `Parent`.
- `Depends On` is provided as dependency metadata, not hard issue links. Create actual links (`blocks/is blocked by`) after import if needed.
