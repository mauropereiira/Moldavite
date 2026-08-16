import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Dropdown, DropdownItem } from './Dropdown';

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
});
