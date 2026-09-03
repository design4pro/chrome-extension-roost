import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { Banner } from './Banner'
import { Toolbar } from './Toolbar'
import { Sidebar } from './Sidebar'
import { TabList } from './TabList'
import type { Row, TreeNode } from '../state/select'

/**
 * The components, in a DOM.
 *
 * These check the parts a pure selector cannot: what is announced, what the
 * keyboard does, and which element the focus ends up on. `chrome.i18n` is not
 * in the fake browser, so it echoes keys back and the assertions read them.
 */
// Re-stubbed per test, because `restoreMocks` puts the original back.
beforeEach(() => {
  vi.spyOn(fakeBrowser.i18n, 'getMessage').mockImplementation(
    (key: string) => key,
  )
})

// jsdom has no ResizeObserver and reports every element as zero-sized; a
// virtualiser asked to fill nothing renders nothing, so the viewport is given
// a size the way the virtualiser measures it.
globalThis.ResizeObserver = class {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element) {
    this.callback([{ target } as ResizeObserverEntry], this)
  }
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { value: 600 })
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { value: 800 })

const tab = (id: string, title: string): Row => ({
  kind: 'tab',
  id,
  data: {
    deviceId: 'd1',
    windowId: 'w1',
    groupId: null,
    url: `https://example.com/${id}`,
    title,
    favIconUrl: '',
    pinned: false,
    discarded: false,
    active: false,
    lastAccessed: 0,
  },
})

const nodes: TreeNode[] = [
  {
    kind: 'device',
    id: 'd1',
    label: 'Chrome',
    online: true,
    local: true,
    level: 1,
  },
  {
    kind: 'window',
    id: 'w1',
    deviceId: 'd1',
    label: 'Docs',
    tabCount: 2,
    level: 2,
  },
  {
    kind: 'device',
    id: 'd2',
    label: 'Canary',
    online: false,
    local: false,
    level: 1,
  },
]

describe('Banner', () => {
  it('says nothing while the connection is fine', () => {
    render(<Banner connection="online" />)
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('explains a connection that needs the user', () => {
    render(<Banner connection="auth_required" />)
    expect(screen.getByRole('status')).toHaveTextContent('banner_auth')
  })
})

describe('Toolbar', () => {
  it('labels the search field and reports what was typed', () => {
    const onQuery = vi.fn()
    render(<Toolbar query="" onQuery={onQuery} resultCount={0} />)

    fireEvent.change(screen.getByLabelText('search_label'), {
      target: { value: 'docs' },
    })
    expect(onQuery).toHaveBeenCalledWith('docs')
  })

  it('announces the count only once there is a search', () => {
    const { rerender } = render(
      <Toolbar query="" onQuery={vi.fn()} resultCount={7} />,
    )
    const statuses = () =>
      screen.getAllByRole('status').map((el) => el.textContent)
    expect(statuses()).toEqual([''])

    rerender(<Toolbar query="do" onQuery={vi.fn()} resultCount={7} />)
    expect(statuses()).toEqual(['results_count'])
  })
})

describe('Sidebar', () => {
  const setup = (overrides: Partial<Parameters<typeof Sidebar>[0]> = {}) => {
    const props = {
      nodes,
      expanded: new Set(['d1']),
      selection: null,
      focusIndex: 0,
      onFocusIndex: vi.fn(),
      onToggle: vi.fn(),
      onSelect: vi.fn(),
      ...overrides,
    }
    render(<Sidebar {...props} />)
    return props
  }

  it('describes the tree to a screen reader', () => {
    setup()
    const items = screen.getAllByRole('treeitem')
    expect(items[0]).toHaveAttribute('aria-level', '1')
    expect(items[0]).toHaveAttribute('aria-expanded', 'true')
    expect(items[1]).toHaveAttribute('aria-level', '2')
    expect(items[2]).toHaveAttribute('aria-expanded', 'false')
  })

  it('keeps a single tab stop and moves with the arrows', () => {
    const props = setup()
    const items = screen.getAllByRole('treeitem')
    expect(items.map((item) => item.tabIndex)).toEqual([0, -1, -1])

    fireEvent.keyDown(screen.getByRole('tree'), { key: 'ArrowDown' })
    expect(props.onFocusIndex).toHaveBeenCalledWith(1)
  })

  it('opens a closed device rather than moving into it', () => {
    const props = setup({ focusIndex: 2 })
    fireEvent.keyDown(screen.getByRole('tree'), { key: 'ArrowRight' })
    expect(props.onToggle).toHaveBeenCalledWith('d2')
    expect(props.onFocusIndex).not.toHaveBeenCalled()
  })

  it('selects a window when it is clicked', () => {
    const props = setup()
    fireEvent.click(screen.getByRole('treeitem', { name: /Docs/ }))
    expect(props.onSelect).toHaveBeenCalledWith({
      deviceId: 'd1',
      kind: 'window',
      id: 'w1',
    })
  })
})

describe('TabList', () => {
  it('shows the rows it is given, under a sticky header', () => {
    render(
      <TabList
        rows={[tab('t1', 'First'), tab('t2', 'Second')]}
        title="Windows"
      />,
    )

    const list = screen.getByRole('listbox', { name: 'Windows' })
    expect(within(list).getByText('First')).toBeDefined()
    expect(screen.getByTestId('panel-header')).toHaveTextContent('Windows')
  })

  it('keeps a focused row clear of the header', () => {
    render(<TabList rows={[tab('t1', 'First')]} title="Windows" />)
    const row = screen.getAllByRole('option')[0] as HTMLElement
    expect(row.style.scrollMarginTop).toBe('48px')
  })

  it('says so when a search matched nothing', () => {
    render(<TabList rows={[]} title="Windows" />)
    expect(screen.getByText('no_results')).toBeDefined()
  })
})
