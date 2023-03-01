import { scaffoldMigrationProject, fakeDepsInNodeModules } from './detect.spec'
import fs from 'fs-extra'
import path from 'path'
import { detectThirdPartyCTFrameworks, validateThirdPartyModule, isThirdPartyDefinition } from '../../src'
import { expect } from 'chai'
import solidJs from './fixtures'

async function scaffoldQwikApp (thirdPartyModuleNames: Array<'cypress-ct-qwik' | '@org/cypress-ct-qwik' | 'misconfigured-cypress-ct-qwik'>) {
  const projectRoot = await scaffoldMigrationProject('qwik-app')

  fakeDepsInNodeModules(projectRoot, [{ dependency: '@builder.io/qwik', version: '0.17.5' }])
  for (const thirdPartyModuleName of thirdPartyModuleNames) {
    const nodeModulePath = path.join(projectRoot, 'node_modules', thirdPartyModuleName)

    await fs.remove(nodeModulePath)
    await fs.copy(path.join(projectRoot, thirdPartyModuleName), nodeModulePath)
  }

  return projectRoot
}

describe('isThirdPartyDefinition', () => {
  context('global package', () => {
    it('returns false for invalid prefix', () => {
      const res = isThirdPartyDefinition({ ...solidJs, type: 'non-cypress-ct' })

      expect(res).to.be.false
    })

    it('returns true for valid prefix', () => {
      const res = isThirdPartyDefinition({ ...solidJs, type: 'cypress-ct-solid-js' })

      expect(res).to.be.true
    })
  })

  context('namespaced package', () => {
    it('returns false for non third party with namespace', () => {
      const res = isThirdPartyDefinition({ ...solidJs, type: '@org/non-cypress-ct' })

      expect(res).to.be.false
    })

    it('returns true for third party with namespace', () => {
      const res = isThirdPartyDefinition({ ...solidJs, type: '@org/cypress-ct-solid-js' })

      expect(res).to.be.true
    })
  })
})

describe('detectThirdPartyCTFrameworks', () => {
  it('detects third party frameworks in global namespace', async () => {
    const projectRoot = await scaffoldQwikApp(['cypress-ct-qwik'])

    const thirdPartyFrameworks = await detectThirdPartyCTFrameworks(projectRoot)

    expect(thirdPartyFrameworks[0].type).eq('cypress-ct-qwik')
  })

  it('detects third party frameworks in org namespace', async () => {
    const projectRoot = await scaffoldQwikApp(['@org/cypress-ct-qwik'])

    const thirdPartyFrameworks = await detectThirdPartyCTFrameworks(projectRoot)

    expect(thirdPartyFrameworks[0].type).eq('@org/cypress-ct-qwik')
  })

  it('ignores misconfigured third party frameworks', async () => {
    const projectRoot = await scaffoldQwikApp(['cypress-ct-qwik', 'misconfigured-cypress-ct-qwik'])

    const thirdPartyFrameworks = await detectThirdPartyCTFrameworks(projectRoot)

    expect(thirdPartyFrameworks.length).eq(1)
    expect(thirdPartyFrameworks[0].type).eq('cypress-ct-qwik')
  })

  it('validates third party module', () => {
    expect(() => validateThirdPartyModule(solidJs)).to.not.throw()

    const gen = (m: any) => m

    expect(() => validateThirdPartyModule(gen({ ...solidJs, type: 'misconfigured' }))).to.throw()
    expect(() => validateThirdPartyModule(gen({ ...solidJs, name: 5 }))).to.throw()
    expect(() => validateThirdPartyModule(gen({ ...solidJs, supportedBundlers: ['random'] }))).to.throw()
    expect(() => validateThirdPartyModule(gen({ ...solidJs, detectors: {} }))).to.throw()
    expect(() => validateThirdPartyModule(gen({ ...solidJs, dependencies: {} }))).to.throw()
    expect(() => validateThirdPartyModule(gen({ ...solidJs, componentIndexHtml: {} }))).to.throw()
  })
})
