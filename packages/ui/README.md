# UI

Shared primitives and design tokens used by every module: `Button`, `Field`, `Select`, `ErrorText`, `Card`, `PageHeader`, `Dropdown*`, `Sheet*`, `Dialog*` and `cn()`.

Built on Tailwind v4 and Radix primitives. Colors, radius and fonts are CSS variables in [`src/styles.css`](src/styles.css), with a `.dark` override — rebrand by editing those.

```tsx
import { Button } from "@templates/ui/button"
import { Card, PageHeader } from "@templates/ui/card"
import { Field } from "@templates/ui/form"
```
