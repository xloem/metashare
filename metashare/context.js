// A Context is an object held by a network to hold its local data.
// It can be used to reference the global data.

// information concept proposal thing
// Let's consider just flat objects.
// Id's are local to network?
// nope!  we will want to store local ids as mapped to global ids in local networks to communicate
// But we can allow _overlap_ between local ids and remove/global ids?
// 	We'll need to look things up by network then ...
// 	sounds reasonable!
// 	Then we can look things up in our network to make replies less ambiguous.
// So:
// 	- change ctx.get to take a network parameter
//
// let's propose that the 'global' object _is_ the source network object.
// we can also return from 'put' to solidify attributes

module.exports = function(metashare, name, where, config = {})
{
	const maps = {}
	this.metashare = metashare
	this.get = function(type, id, network)
	{
		if (!(type in maps)) {
			maps[type] = {}
		}
		const global = metashare.get(type, id, network).global
		const map = maps[type]
		if (!(global.id in map)) {
			map[global.id] = {
				global: global
			}
		}
		return map[global.id]
	}
	this.put = function(type, id, object)
	{
		return metashare.put(name, type, id, object)
	}

	this.network = this.put('network', name, {
		where: where,
		config: config
	})
}
