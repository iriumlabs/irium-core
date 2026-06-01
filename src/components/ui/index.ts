// Binance-style trading UI primitives — used by the Marketplace and
// Settlement redesign. Coexists with the legacy gradient brand surfaces
// outside `src/pages/marketplace/`, `src/pages/Marketplace.tsx`, and
// `src/pages/settlement-ui/`; do not import these primitives into
// non-trading screens unless the design is intentionally adopting the
// neutral grayscale palette.

export { default as Pill } from './Pill';
export type { PillIntent, PillSize, PillProps } from './Pill';

export { default as Tabs } from './Tabs';
export type { TabIntent, TabsVariant, TabSpec, TabsProps } from './Tabs';

export {
  default as Table,
  Table as TableEl,
  THead,
  TBody,
  TR,
  TH,
  TD,
} from './Table';
export type { TableProps, TRProps, THProps, TDProps } from './Table';

export { default as Drawer } from './Drawer';
export type { DrawerWidth, DrawerProps } from './Drawer';

export { default as TradingModal } from './TradingModal';
export type { ModalSize, TradingModalProps } from './TradingModal';

export { default as NumberDelta } from './NumberDelta';
export type { NumberDeltaProps } from './NumberDelta';

export { default as TimestampDisplay } from './TimestampDisplay';
export type { TimestampFormat, TimestampDisplayProps } from './TimestampDisplay';
