const Metashare = require('../metashare/metashare')
const Ctx = require('../metashare/context')
const Bitcoin = require('../bridges/bitcoin')

const assert = require('assert')

const os = require('os')

// describe('bsv live', () => {
// describe('bch regtest live', () => {
// describe('bsv stn live', () => {
describe('bch live', () => {
  var metashare = null
  var bitcoin = null
  before(async function () {
    this.timeout(60000)
    metashare = await Metashare()
    // let ctx = await Ctx(metashare, 'Bitcoin SV', os.homedir() + '/.bitcoin.sv', 'Bitcoin Satoshi Vision')
    // let ctx = await Ctx(metashare, 'Bitcoin Cash/regtest', os.homedir() + '/.bitcoin.cash/regtest')
    // let ctx = await Ctx(metashare, 'Bitcoin SV STN', os.homedir() + '/.bitcoin.sv/stn', 'Bitcoin Satoshi Vision Scaling Test Network')
    // let ctx = await Ctx(metashare, 'Bitcoin Cash', os.homedir() + '/.bitcoin.cash', null, { startblock: '000000000000000000651ef99cb9fcbe0dadde1d424bd9f15ff20136191a5eec' })
    let ctx = await Ctx(metashare, 'Bitcoin Cash', os.homedir() + '/.bitcoin.cash', null, { startblock: '00000000000000000151626f5574cc1981206df1a6200bff1139c26363bb6245' })
    bitcoin = await Bitcoin(ctx)
  })
  it('constructs', async () => {
    assert(bitcoin !== null)
  })
  it('syncs', async () => {
    await bitcoin.sync()
  }).timeout(60 * 60000)
  after(async () => {
    await metashare.destroy()
  })
})

if (run) run()
