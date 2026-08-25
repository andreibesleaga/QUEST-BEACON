// BEACON — UI kit barrel (E8·T-345a). Single import surface for the accessible design-system primitives,
// BEACON status badges, state components, legend, and theme toggle. Panel/map agents import from here.

// Primitives
export { Button, IconButton, buttonVariants } from './button.js';
export type { ButtonProps, IconButtonProps } from './button.js';
export { Card, Panel } from './card.js';
export type { CardProps, PanelProps } from './card.js';
export { VisuallyHidden } from './visually-hidden.js';
export type { VisuallyHiddenProps } from './visually-hidden.js';
export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogTitle,
  DialogDescription,
  DialogContent,
} from './dialog.js';
export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from './dropdown-menu.js';
export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor, PopoverClose } from './popover.js';
export { Tabs, TabsList, TabsTrigger, TabsContent } from './tabs.js';
export { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from './tooltip.js';

// BEACON status badges
export { BadgeShell } from './badge.js';
export type { BadgeShellProps } from './badge.js';
export { FreshnessBadge, computeFreshness } from './freshness-badge.js';
export type { FreshnessBadgeProps, FreshnessMode, FreshnessState } from './freshness-badge.js';
export { UnverifiedBadge } from './unverified-badge.js';
export type { UnverifiedBadgeProps } from './unverified-badge.js';
export { SeverityTag, SEVERITY_META, SEVERITY_ORDER } from './severity-tag.js';
export type { SeverityTagProps, Severity, SeverityMeta } from './severity-tag.js';
export { ModeBadge, MODE_META, MODE_ORDER } from './mode-badge.js';
export type { ModeBadgeProps, SourceMode } from './mode-badge.js';
export { ProvenancePopover } from './provenance-popover.js';
export type { ProvenancePopoverProps, ProvenanceEntry } from './provenance-popover.js';
export { ExternalViewLinks } from './external-view-links.js';
export type { ExternalViewLinksProps } from './external-view-links.js';

// State components
export { Skeleton } from './skeleton.js';
export type { SkeletonProps } from './skeleton.js';
export { EmptyState } from './empty-state.js';
export type { EmptyStateProps } from './empty-state.js';
export { ErrorState } from './error-state.js';
export type { ErrorStateProps } from './error-state.js';
export { ErrorBoundary } from './error-boundary.js';
export type { ErrorBoundaryProps } from './error-boundary.js';

// Legend + theme
export { Legend } from './legend.js';
export type { LegendProps } from './legend.js';
export { ThemeToggle } from './theme-toggle.js';
export { LocaleSwitcher } from './locale-switcher.js';
export { OriginalLanguageChip } from './original-language-chip.js';
export type { Theme } from './theme-toggle.js';

// Utilities
export { formatRelativeTime, toEpochMs } from './relative-time.js';
