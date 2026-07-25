# Visual identity and accessibility

FuelRadar keeps the existing logo and a quiet, mobile-first sage palette. The
interface uses the logo as the primary brand asset; Open Graph and Twitter
metadata reuse it together with the existing payoff, without introducing a
second mark or a rebrand.

## Design tokens

The global tokens in `src/app/globals.css` are the single source of truth for:

- sage brand steps (`--sage-*`);
- page, panel, subtle and overlay surfaces (`--surface-*`);
- primary, muted and inverse text (`--text-*`);
- default and strong borders (`--border-*`);
- danger, warning, favorite and selected states (`--status-*`);
- focus, radii, shadows, touch targets and body leading.

Component rules should use the semantic tokens instead of adding literal UI
colours. New status colours need both a surface and a text/border token, so that
meaning never depends on colour alone.

## Contrast and interaction

Core colour pairs meet WCAG AA for normal text: muted text on white is 5.47:1,
white on sage 700 is 5.70:1, white on the focus/selected green is 9.58:1,
danger text on its surface is 8.69:1, and warning text on its surface is 7.73:1.
Interactive sage 500 borders reach 3.03:1 against white, meeting the non-text
contrast threshold for visible control boundaries.
Controls have a three-pixel focus ring and use native semantic elements. Primary
mobile controls and list actions expose a target of at least 48 CSS pixels.

The selected map price keeps a non-colour cue (border and halo), while loading,
empty, warning and error states retain visible text and suitable live-region
semantics.

## Responsive behaviour

The results panel is a scrollable bottom sheet on narrow screens and a bounded
side panel on desktop. Header navigation reflows below the brand on very narrow
or zoomed viewports. Long station names, addresses, dates and price rows wrap
instead of clipping. The sheet and dialog account for iOS top, side and bottom
safe areas, and remain independently scrollable at 200% text zoom.

Motion respects `prefers-reduced-motion`. The layout targets current Chromium,
Firefox and Safari engines and does not require hover for any action.
