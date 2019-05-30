modules.exports = function(metashare, contextname, where, config = {})
{
	var maps = {}
	this.where = where
	this.config = config
	this.createMap = function(type, globalid, localid)
	{
		if (!(type in maps)) {
			maps[type] = {}
		}
		maps[type] = {
			'id': localid,
			'global': metashare.get(type, globalid)
		}
	}
}
