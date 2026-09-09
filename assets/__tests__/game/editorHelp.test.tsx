/**
 * THE EDITOR'S SELF-DOCUMENTATION (games-page UX design §4.9, fixing §3.4 "Nothing tells the user
 * how to use the editor" — a P0).
 *
 * Two surfaces, one contract: the chip states the current mode on the canvas, and the help sheet
 * lists every shortcut FROM the shortcut table. These tests render the real components and read the
 * DOM, so a sheet that silently stopped listing a group, or a chip that stopped naming its mode,
 * fails here rather than in front of Alexander.
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { CanvasModeChip, HelpSheet } from '@/components/game/editorHelp'
import { EDITOR_ACTIONS, SHORTCUT_GROUPS } from '@/game/shortcuts'

import { installLiveCatalogs } from '@/__tests__/helpers/catalogs'

beforeEach(installLiveCatalogs)

describe('the canvas mode chip', () => {
  it('states the mode and its gesture', () => {
    render(<CanvasModeChip connectorMode={false} buildingTool={null} entityTool={null} armedTileLabel="grass" />)
    expect(screen.getByText(/Painting "grass"/)).toBeInTheDocument()
    expect(screen.getByText(/Alt-click erases/)).toBeInTheDocument()
  })

  it('is announced politely — it changes while the user works, so it must not steal focus', () => {
    render(<CanvasModeChip connectorMode buildingTool={null} entityTool={null} armedTileLabel={null} />)
    const chip = screen.getByRole('status')
    expect(chip).toHaveAttribute('aria-live', 'polite')
    expect(chip).toHaveTextContent(/Placing a connection/)
  })

  it('still shows in Select — a mode chip that disappears teaches nothing', () => {
    render(<CanvasModeChip connectorMode={false} buildingTool={null} entityTool={null} armedTileLabel={null} />)
    expect(screen.getByRole('status')).toHaveTextContent(/Select/)
  })
})

describe('the help sheet', () => {
  const openSheet = () => render(<HelpSheet onClose={jest.fn()} />)

  it('lists every group the table declares', () => {
    openSheet()
    for (const group of SHORTCUT_GROUPS) {
      expect(screen.getByText(group.title.toUpperCase())).toBeInTheDocument()
    }
  })

  it('lists every dispatched editor action, so the sheet cannot under-report the editor', () => {
    openSheet()
    for (const action of EDITOR_ACTIONS) {
      expect(screen.getByText(action.does)).toBeInTheDocument()
    }
  })

  it('shows the chord next to what it does', () => {
    openSheet()
    const copy = screen.getByText('copy tiles')
    expect(copy.closest('tr')).toHaveTextContent('Ctrl+C')
  })

  it('closes on the close button', () => {
    const onClose = jest.fn()
    render(<HelpSheet onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalled()
  })

  it('names the ability bound RIGHT NOW, not a hardcoded key list', () => {
    render(<HelpSheet onClose={jest.fn()} specialKeys={['5', '6', '7', '8']} />)
    expect(screen.getByText(/Fire Slash/)).toBeInTheDocument()
    expect(screen.getByText('quick-slot items').closest('tr')).toHaveTextContent('5 – 8')
  })
})
