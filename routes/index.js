/*
 * GET home page.
 */
var cclog = require('cclog');

var redisPool = {};

function getClient(port, host, db) {
  var key = host + ':' + port + ':' + db;
  var client = redisPool[key];
  if(!client) {
    client = redisPool[key] = require('redis').createClient(port, host);
    client.select(db);
  }
  return client;
}

exports.index = function(req, res){
    var query = req.query || {};
    var key = query.key || '';
    var search = query.search || '';
    var op = query.op ||'';
    var count = query.count || 20;
    var cursor = query.cursor || 0;
    var match = search ? '*' + search + '*' : '*';
    var host = query.host || 'localhost';
    var port = parseInt(query.port) || 6379;
    var db = parseInt(query.db) || 0;
    var redis = getClient(port, host, db);
    var usescan = query.usescan || '';

    function myscan(scantype, cursor, match, count, callback) {
        if(!usescan) {
            function _callback(err, results) {
                callback(err, [0, results]);
            }
            switch(scantype) {
              case 'hscan':
                return redis.hgetall(key, function(err, results) {
                        var ret = [];
                        for(var k in results) {
                            ret.push(k);
                            ret.push(results[k]);
                        }
                        _callback(err, ret);
                });
              case 'sscan':
                return redis.smembers(key, _callback)
              case 'lscan':
                return redis.lrange(key, 0, -1, _callback);
              case 'zscan':
                return redis.zrange(key, 0, -1, 'withscores', _callback);
              case 'scan':
                return redis.keys(match, _callback);
            }
        } else {
            if(scantype == 'scan') {
                return redis.scan(cursor, 'match', match, 'count', count, callback)
            }
            redis[scantype](key, cursor, 'match', match, 'count', count, callback)
        }
    }

    function render(options) {
        var params = {
            prevcursor: cursor
          , search: search
          , op: op
          , count: count
          , key: key
          , host: host
          , port: port
          , db: db
          , usescan: usescan
        }
        for(var k in options) {
            params[k] = options[k];
        }
        res.render('index', params);
    }

    if(key) {
        redis.type(key, function(err, type) {
                function scan(scantype) {
                    return function (err, len) {
                        if(err) return cclog.error(err);
                        myscan(scantype, cursor, match, count, function(err, results) {
                            if(err) return cclog.error(err);
                            render({
                                    type: type
                                  , len: len
                                  , cursor: results && results[0] || 0
                                  , results: results && results[1] || []
                            })
                        })
                    }
                }
                switch(type) {
                  case 'hash':
                    return redis.hlen(key, scan('hscan'));
                  case 'set':
                    return redis.scard(key, scan('sscan'));
                  case 'sorted_set':
                  case 'zset':
                    return redis.zcard(key, scan('zscan'));
                  case 'list':
                    return redis.llen(key, scan('lscan'));
                  default:
                  case 'string':
                    redis.get(key, function(err, value) {
                            if(err) return cclog.error(err);
                            myscan('scan', cursor, '*' + key + '*', count, function(err, results) {
                                    render({
                                            cursor: results[0]
                                          , value: value
                                          , results: results[1]
                                    })
                            })
                    });
                }
        })

    } else {
        return myscan('scan', cursor, match, count, function (err, results) {
                if(err) return cclog.error(err);
                render({
                        cursor: results[0]
                      , results: results[1]
                })
        })
    }
};
