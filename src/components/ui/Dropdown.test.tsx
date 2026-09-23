import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Dropdown, DropdownItem, DropdownStatic } from './Dropdown';

describe('Dropdown', () => {
  it('closes after an actionable item nested in a Fragment is selected', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();

    render(
      <Dropdown trigger={<button>Open actions</button>}>
        <>
          <DropdownItem onClick={onSelect}>First action</DropdownItem>
          <DropdownItem>Second action</DropdownItem>
        </>
      </Dropdown>
    );

    await user.click(screen.getByRole('button', { name: 'Open actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'First action' }));

    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  // A choice in a menu opened from another menu ends the whole interaction;
  // the outer one used to stay open under the toast the action raised.
  it('closes the menu it was opened from when a nested item is chosen', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();

    render(
      <Dropdown trigger={<button>Actions</button>}>
        <DropdownStatic>
          <Dropdown trigger={<button>Share</button>}>
            <DropdownItem onClick={onSelect}>Copy wiki link</DropdownItem>
          </Dropdown>
        </DropdownStatic>
      </Dropdown>
    );

    await user.click(screen.getByRole('button', { name: 'Actions' }));
    await user.click(screen.getByRole('button', { name: 'Share' }));
    await user.click(screen.getByRole('menuitem', { name: 'Copy wiki link' }));

    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Share' })).not.toBeInTheDocument();
  });

  it('keeps a keepMounted menu mounted, hidden, while closed', async () => {
    const user = userEvent.setup();
    let mounts = 0;
    function Child() {
      const [id] = React.useState(() => ++mounts);
      return <DropdownItem>Item {id}</DropdownItem>;
    }

    render(
      <Dropdown keepMounted trigger={<button>Open</button>}>
        <DropdownStatic>
          <Child />
        </DropdownStatic>
      </Dropdown>
    );

    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.click(screen.getByRole('button', { name: 'Open' }));

    expect(screen.getByRole('menuitem', { name: 'Item 1' })).toBeInTheDocument();
    expect(mounts).toBe(1);
  });
});
