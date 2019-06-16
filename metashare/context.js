// A Context is an object held by a network to hold its local data.
// It can be used to reference the global data.

// is this still needed?
// all it really does is remember the netdbid

module.exports = async function (metashare, id, where = null, name = null, config = null) {
  this.metashare = metashare
  // either get our netdbid or make ourselves new

  let net = {}
  let netdbid
  {
    let matchingNets = metashare.get('net', null, { id: id })
    if (matchingNets.length > 1) {
      throw new Error('duplicate entries for this id in database.')
    }

    net.id = id
    if (where) {
      net.where = where
    }
    if (name) {
      net.name = name
    }
    if (config) {
      net.cust = config
    }

    if (matchingNets.length === 0) {
      if (name === null) {
        net.name = id
      }
      netdbid = await metashare.put('net', null, net)
    } else {
      net.dbid = netdbid = matchingNets[0].dbid
      if (Object.keys(net).length > 1) {
        await metashare.put('net', netdbid, net)
      }
    }

    net = (await metashare.get('net', netdbid))[0]
  }
  this.net = net

  this.get = async function (type, id) {
    const res = await metashare.get(type, netdbid, { id: id })
    if (res.length === 0) {
      return undefined
    }
    if (res.length > 1) {
      throw new Error('multiple results: should not happen')
    }
    return res[0]
  }
  this.put = async function (type, id, object) {
    object.id = id
    await metashare.put(type, netdbid, object)
    return object
  }
}

// adding special cases to these functions didn't seem to be the way to go, it really slowed
// progress down in the face of confusion.
// INSTEAD:
//  - either make small new functions
//  - or preferably generalize the needed change and apply concept-wide
//  and test it!
