/**
 * Writing what a unit says, in its Character window.
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { UnitDialogsSection } from '@/components/modals'
import type { Quest, UnitDialog } from '@/game/types'

const quests: Quest[] = [{ id: 'cat', giverId: 'n', title: 'Find the cat', description: '', objectives: [], rewards: [], state: 'available' }]
const lastCall = (fn: jest.Mock) => fn.mock.calls[fn.mock.calls.length - 1][0] as UnitDialog[]

describe('the Dialogs section', () => {
  it('says the unit says nothing yet, and adds a dialog', () => {
    const onChange = jest.fn()
    render(<UnitDialogsSection dialogs={[]} quests={quests} onChange={onChange} />)
    expect(screen.getByText(/says nothing yet/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /add a dialog/i }))
    expect(lastCall(onChange)).toHaveLength(1)
    expect(lastCall(onChange)[0]).toMatchObject({ kind: 'static', lines: [] })
  })

  it('takes its lines one per line', () => {
    const onChange = jest.fn()
    render(<UnitDialogsSection dialogs={[{ id: 'a', kind: 'static', lines: [] }]} quests={quests} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Dialog 1 lines'), { target: { value: 'Hello.\nNice day.' } })
    expect(lastCall(onChange)[0].lines).toEqual(['Hello.', 'Nice day.'])
  })

  it('a quest dialog picks one of the level\'s quests and the state it waits for', () => {
    const onChange = jest.fn()
    render(<UnitDialogsSection dialogs={[{ id: 'a', kind: 'quest', lines: ['Well?'], questState: 'available' }]} quests={quests} onChange={onChange} />)
    const pick = screen.getByLabelText('Dialog 1 quest') as HTMLSelectElement
    expect([...pick.options].map(o => o.textContent)).toContain('Find the cat')
    fireEvent.change(pick, { target: { value: 'cat' } })
    expect(lastCall(onChange)[0]).toMatchObject({ questId: 'cat' })
    fireEvent.change(screen.getByLabelText('Dialog 1 quest state'), { target: { value: 'active' } })
    expect(lastCall(onChange)[0]).toMatchObject({ questState: 'active' })
  })

  it('a situational dialog picks the situation it waits for', () => {
    const onChange = jest.fn()
    render(<UnitDialogsSection dialogs={[{ id: 'a', kind: 'situational', lines: ['Late.'], situation: 'night' }]} quests={quests} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Dialog 1 situation'), { target: { value: 'rain' } })
    expect(lastCall(onChange)[0]).toMatchObject({ situation: 'rain' })
  })

  it('changing the kind keeps the lines already written', () => {
    const onChange = jest.fn()
    render(<UnitDialogsSection dialogs={[{ id: 'a', kind: 'static', lines: ['Keep me.'] }]} quests={quests} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Dialog 1 kind'), { target: { value: 'situational' } })
    expect(lastCall(onChange)[0]).toMatchObject({ kind: 'situational', lines: ['Keep me.'], situation: 'night' })
  })

  it('removes one dialog and leaves the others', () => {
    const onChange = jest.fn()
    render(<UnitDialogsSection dialogs={[{ id: 'a', kind: 'static', lines: ['One'] }, { id: 'b', kind: 'static', lines: ['Two'] }]} quests={quests} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove dialog 1' }))
    expect(lastCall(onChange).map(d => d.id)).toEqual(['b'])
  })
})
