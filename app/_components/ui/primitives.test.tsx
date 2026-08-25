// @vitest-environment happy-dom
// BEACON — remaining primitive smoke tests (E8·T-345a): DropdownMenu, Tabs, Tooltip, Card/Panel,
// VisuallyHidden. Confirms correct roles/labels + keyboard operation from the Radix wrappers.
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from './dropdown-menu.js';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './tabs.js';
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from './tooltip.js';
import { Card, Panel } from './card.js';
import { VisuallyHidden } from './visually-hidden.js';

describe('DropdownMenu', () => {
  it('opens from the keyboard and exposes menuitem roles', async () => {
    const user = userEvent.setup();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Act</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Task resource</DropdownMenuItem>
          <DropdownMenuItem>Draw evac route</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    screen.getByRole('button', { name: 'Act' }).focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByRole('menu')).toBeInTheDocument());
    expect(screen.getByRole('menuitem', { name: 'Task resource' })).toBeInTheDocument();
  });
});

describe('Tabs', () => {
  it('renders tablist/tab/tabpanel with a selected tab', () => {
    render(
      <Tabs defaultValue="sitrep">
        <TabsList>
          <TabsTrigger value="sitrep">SitRep</TabsTrigger>
          <TabsTrigger value="logistics">Logistics</TabsTrigger>
        </TabsList>
        <TabsContent value="sitrep">Summary</TabsContent>
        <TabsContent value="logistics">Board</TabsContent>
      </Tabs>,
    );
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'SitRep' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Summary');
  });
});

describe('Tooltip', () => {
  it('shows content on keyboard focus (not pointer-only)', async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger>Info</TooltipTrigger>
          <TooltipContent>Fire perimeter freshness</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
    await user.tab();
    expect(screen.getByRole('button', { name: 'Info' })).toHaveFocus();
    await waitFor(() =>
      expect(screen.getAllByText('Fire perimeter freshness').length).toBeGreaterThan(0),
    );
  });
});

describe('Card / Panel', () => {
  it('Panel is a labelled region with a heading', () => {
    render(<Panel title="Logistics">rows</Panel>);
    const region = screen.getByRole('region', { name: 'Logistics' });
    expect(region).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Logistics' })).toBeInTheDocument();
  });

  it('Card renders its children', () => {
    render(<Card>content</Card>);
    expect(screen.getByText('content')).toBeInTheDocument();
  });
});

describe('VisuallyHidden', () => {
  it('keeps text in the accessibility tree via sr-only', () => {
    render(<VisuallyHidden>screen-reader label</VisuallyHidden>);
    const el = screen.getByText('screen-reader label');
    expect(el).toBeInTheDocument();
    expect(el).toHaveClass('sr-only');
  });
});
