import { describe, expect, it } from 'vitest'
import { buildRoutedClassificationTask } from './classify'

const build = (name: string, molecularFormula = '') =>
  buildRoutedClassificationTask({ name, molecularFormula }, 'test', { status: 'not_supplied', cacheHit: false }, 'v2')
describe('auxiliary classification v2 consistency checks', () => {
  it.each(['무수 아세트산아연', '시약명 아세트산 구리', 'Nickel(II) acetate', 'Cadmium bromide'])(
    'retains existing higher-priority families for %s',
    (name) => {
      const task = build(name)
      expect(task.blockedChoices).toContain('ORGANIC_NON_HALOGEN')
      for (const allowed of ['UNKNOWN', 'HEAVY_METAL', 'CYANIDE', 'REACTIVE'])
        expect(task.blockedChoices).not.toContain(allowed)
    },
  )
  it('checks the stated metal even when another listed metal is present and retains explicit review', () => {
    const task = build('Zinc acetate', 'Cu(C2H3O2)2')
    expect(task.blockedChoices).toHaveLength(9)
    expect(task.blockedChoices).not.toContain('UNKNOWN')
  })
  it('distinguishes ionic sulfide from sulfate and organic sulfides', () => {
    expect(build('Zinc sulfide').blockedChoices).toContain('HEAVY_METAL')
    expect(build('황화구리').blockedChoices).not.toContain('CYANIDE')
    expect(build('Zinc sulfate').blockedChoices).not.toContain('HEAVY_METAL')
    expect(build('dimethyl sulfide', 'C2H6S').blockedChoices).not.toContain('ORGANIC_NON_HALOGEN')
    expect(build('titanium dioxide powder').blockedChoices).toContain('HEAVY_METAL')
    expect(build('Copper foil').blockedChoices).not.toContain('HEAVY_METAL')
  })
  it('routes corroborated acid and base forms once and keeps name-only cues on Decisions', () => {
    for (const task of [build('Boric acid powder', 'H3BO3'), build('Lithium hydroxide pellets', 'LiOH')]) {
      expect(task.provider).toBe('responses')
      expect(task.blockedChoices).toContain('SOLID_WASTE')
      expect(task.blockedChoices).toContain('ORGANIC_NON_HALOGEN')
      expect(task.blockedChoices).not.toContain('REACTIVE')
    }
    expect(build('Boric acid powder').provider).toBe('decisions')
    expect(build('Acetic acid', 'C2H4O2').blockedChoices).not.toContain('ORGANIC_NON_HALOGEN')
  })
})
