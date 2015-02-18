var async = require('async')
  , mongoose = require('mongoose')
  , _ = require('underscore')
  , utils = require('./utils');

//load config.js
try {
  var config = require('../config.js');
} catch (e) {
  handleError(new Error('Cannot find config.js'));
}

var db = mongoose.connect(config.mongo_url);

require('../models/Agency');
require('../models/Calendar');
require('../models/CalendarDate');
require('../models/FareAttribute');
require('../models/FareRule');
require('../models/FeedInfo');
require('../models/Frequencies');
require('../models/Route');
require('../models/Shape');
require('../models/Stop');
require('../models/StopTime');
require('../models/Transfer');
require('../models/Trip');

var Agency = db.model('Agency')
  , Calendar = db.model('Calendar')
  , Route = db.model('Route')
  , Shape = db.model('Shape')
  , Stop = db.model('Stop')
  , StopTime = db.model('StopTime')
  , Trip = db.model('Trip')
  , Calendar = db.model('Calendar');


module.exports = { 
  //CUSTOM METHODS for MTA

  getSchedule: function(agency_key, route_id, cb){
    //gets today's stops and times for the current route
    var direction_id = 0;


    var numOfTimes = 1000; //this is dumb but no calls to getTimesByStop() seem
    //to want to give it a numOfTimes argument. 1000 is probably at least 10x
    //more times than will be returned.
    
    
    //gets routes for one agency
    
    if (_.isFunction(direction_id)) {
      cb = direction_id;
      direction_id = null; //default is ~ 1/4 mile
    }

    var today = new Date()
      , service_ids = []
      , trip_ids = []
      , stopTimes = [];

    var d = new Date();
    var utc = d.getTime() + (d.getTimezoneOffset() * 60000);
    var now = new Date(utc + (3600000*(-4)));
    var nowHour = now.getHours();
    var nowMinute = now.getMinutes();
    var nowSecond = now.getSeconds();
    var nowDispHour = (nowHour < 10) ? '0' + nowHour : nowHour;
    var nowDispMinute = (nowMinute < 10) ? '0' + nowMinute : nowMinute;
    var nowDispSecond = (nowSecond < 10) ? '0' + nowSecond : nowSecond;

    var currentTime = nowDispHour+':'+nowDispMinute+':'+nowDispSecond;

    //Find service_id that matches todays date
    async.series([
      findServices,
      findTrips
    ], function(e, results){
      if(e){
        cb(e,null);
      } else {
        console.log('sending stopTimes to callback');
        cb(e, trip_ids);
      }
    });


    function findServices(cb){
      var query = { agency_key: agency_key }
        , todayFormatted = utils.formatDay(today);
   
      //build query
      query[utils.getDayName(today).toLowerCase()] = 1;
  
      Calendar
        .find(query)
        .where('start_date').lte( todayFormatted )
        .where('end_date').gte( todayFormatted )
        .exec(function(e, services){
          if(services.length){
            services.forEach(function(service){
              service_ids.push(service.service_id);
              console.log(service_ids);
            });
            cb(null, 'services');
          } else {
            cb(new Error('No Service for this date'), 'services');
          }
        });
    }

    function findTrips(cb){   
      var query = {
        agency_key: agency_key,
        route_id: route_id
      }
      

      Trip
        .find(query)
        .where('service_id').in(service_ids)
        .exec(function(e, trips){
          console.log("got trips: " + trips.length)
          if(trips.length){
            async.each(trips,function(trip, cb){
              console.log("calling asyc");
              var thisTrip = {}; //necessary because trip is controlled by mongoose?
              thisTrip.trip_id = trip.trip_id;
              thisTrip.direction_id = trip.direction_id;
              //remove unnecessary Data
              //findStopTimes for this trip
              thisTrip.stopTimes = [];
              findStopTimes(trip.trip_id, function(times) {
                async.each(times,function(time,cb){
                  var thisTime = {};
                  thisTime.arrival_time = time.arrival_time;
                  thisTime.departure_time = time.departure_time;
                  thisTime.stop_id = time.stop_id;
                  thisTime.stop_sequence = time.stop_sequence;
                  thisTime.stopIndex = getStopIndex(route_id,thisTime.stop_id, thisTrip.direction_id);

                  thisTrip.stopTimes.push(thisTime);
                  cb();
                },function(){
                  console.log(thisTrip);
                  trip_ids.push(thisTrip);
                  cb();
                })
              })
            },function(err){
              cb(null, 'trips')
            });
          } else {
            cb(new Error('No trips for this date'), 'trips');
          }
        });
    }
    //figure out how many stops into the trip a given stop is, for charting purposes
    function getStopIndex(route_id,stop_id,direction_id) {
      //get array of all stop_ids for given route and direction
      //of course, do this only once for 

      //return index of our stop_id
    }

    function findStopTimes(trip_id, cb){
      var query = {
        //route_id: route_id
      }

      StopTime
        .find()
        .where('trip_id').equals(trip_id)
        .sort('stop_sequence')
        .exec(function(e, times){
            cb(times);
          
        });
    }
    

  },

  //END CUSTOM METHODS


  agencies: function(cb){
    //gets a list of all agencies
    Agency.find({}, cb);
  },

  getRoutesByAgency: function(agency_key, cb){
    //gets routes for one agency

    Route.find({ agency_key: agency_key }, cb);
  },

  
  getAgenciesByDistance: function(lat, lon, radius, cb){
    //gets all agencies within a radius
    
    if (_.isFunction(radius)) {
      cb = radius;
      radius = 25; // default is 25 miles
    }

    lat = parseFloat(lat);
    lon = parseFloat(lon);

    var radiusInDegrees = Math.round(radius/69*100000)/100000;
    
    Agency
      .where('agency_center')
      .near(lon, lat).maxDistance(radiusInDegrees)
      .exec(cb);
  },

  getRoutesByDistance: function(lat, lon, radius, cb){
    //gets all routes within a radius

    if (_.isFunction(radius)) {
      cb = radius;
      radius = 1; //default is 1 mile
    }

    lat = parseFloat(lat);
    lon = parseFloat(lon);

    var radiusInDegrees = Math.round(radius/69*100000)/100000
      , stop_ids = []
      , trip_ids = []
      , route_ids = []
      , routes = [];
  
    async.series([
      getStopsNearby,
      getTrips,
      getRoutes,
      lookupRoutes
    ], function(e, results){
      cb(e, routes);
    });
  
    function getStopsNearby(cb){
      Stop
        .where('loc')
        .near(lon, lat).maxDistance(radiusInDegrees)
        .exec(function(e, stops){
          if(stops.length){
            stops.forEach(function(stop){
              if(stop.stop_id){
                stop_ids.push(stop.stop_id);
              }
            });
            cb(e, 'stops');
          } else {
            cb(new Error('No stops within ' + radius + ' miles'), 'stops');
          }
        });
    }
  
    function getTrips(cb){
      StopTime
        .distinct('trip_id')
        .where('stop_id').in(stop_ids)
        .exec(function(e, results){
          trip_ids = results;
          cb(e, 'trips');
        });
    }
  
    function getRoutes(cb){
      Trip
        .distinct('route_id')
        .where('trip_id').in(trip_ids)
        .exec(function(e, results){
          if(results.length){
            route_ids = results;
            cb(null, 'routes');
          } else {
            cb(new Error('No routes to any stops within ' + radius + ' miles'), 'routes');
          }
        });
    }
  
    function lookupRoutes(cb){
      Route
        .where('route_id').in(route_ids)
        .exec(function(e, results){
          if(results.length){
            routes = results;
            cb(null, 'lookup');
          } else {
            cb(new Error('No information for routes'), 'lookup');
          }
        });
    }
  },

  getStopsByRoute: function(agency_key, route_id, direction_id, cb){
    //gets stops for one route
    
    if (_.isFunction(direction_id)) {
      cb = direction_id;
      direction_id = null;
    }

    var longestTrip = {}
      , stops = {}
      , trip_ids = {}
      , direction_ids = [];
  
    async.series([
      getTrips,
      getStopTimes,
      getStops
    ], function(e, res){
      // transform results based on whether direction_id was
      // - specified (return stops for a direction)
      // - or not specified (return stops for all directions)
      var results = [];
      if (direction_id){
        results = stops[direction_id] || [];
      } else {
        _.each(stops, function(stops, direction_id){
          results.push({ direction_id: direction_id, stops: stops || [] });
        });
      }
      cb(e, results);
    });

    function getTrips(cb){
      var tripQuery = {
            agency_key: agency_key
          , route_id: route_id
        };
      if(direction_id){
        tripQuery.direction_id = direction_id;
      } // else match all direction_ids

      Trip
        .count(tripQuery, function(e, tripCount){
          if(tripCount){
            //grab up to 30 random samples from trips to find longest one.
            //sample size might affect out of all available trips for the route, which trip we determined is the longest.
            var count = 0;
            var sampleSize = 250; // (magic number, poof)
            var samplingSizeThreshold = 250; // (magic number, poof-poof)
            async.whilst(
              function(){ return count < (( tripCount > sampleSize ) ? sampleSize : tripCount); },
              function (cb) {
                Trip
                  .findOne(tripQuery)
                  // Sampling from trip population to determine the longest trip makes the function non-deterministic
                  // and this is unnecessary if the difference between population and sample size is too little.
                  // So we only use sampling if this difference meets a certain threshold;
                  // else we sample the entire population
                  //.skip(Math.floor(Math.random()*tripCount))
                  .skip((tripCount - sampleSize > samplingSizeThreshold) ? Math.floor(Math.random()*tripCount) : count)
                  .exec(function(e, trip){
                    if(!trip) return cb();
                    if (direction_ids.indexOf(trip.direction_id) < 0) direction_ids.push(trip.direction_id);
                    if (!trip_ids[trip.direction_id]) trip_ids[trip.direction_id] = [];
                    trip_ids[trip.direction_id].push(trip.trip_id);
                    cb();
                  });
                count++;
              },
              function(e){
                cb(null, 'trips')
              });
          } else {
            cb(new Error('Invalid agency_key or route_id'), 'trips');
          }
        }); 
    }

    function getStopTimes(cb){
      async.forEach(
        direction_ids,
        function(direction_id, cb){
          if (!trip_ids[direction_id]) return cb();
          async.forEach(
            trip_ids[direction_id],
            function(trip_id, cb){
              StopTime.find(
                { agency_key: agency_key, trip_id: trip_id }
                , null
                , { sort: 'stop_sequence' }
                , function(e, stopTimes){
                  //compare to longest trip for given direction_id to see if trip length is longest for given direction
                  if(!longestTrip[direction_id]) longestTrip[direction_id] = [];
                  if(stopTimes.length && stopTimes.length > longestTrip[direction_id].length){
                    longestTrip[direction_id] = stopTimes;
                  }
                  cb();
                }
              );
            }.bind(direction_id),
            function(e){
              cb();
            }
          );
        }, function(e){
          cb(null, 'times');
        }
      );
    }

    function getStops(cb){
      async.forEach(
        direction_ids,
        function(direction_id, cb){
          if (!longestTrip[direction_id]) return cb();
          async.forEachSeries(
            longestTrip[direction_id],
            function(stopTime, cb){
              Stop.findOne(
                { agency_key: agency_key, stop_id: stopTime.stop_id }
                , function(e, stop){
                  if(!stops[direction_id]) stops[direction_id] = [];
                  stops[direction_id].push(stop);
                  cb();
                }
              );
            }.bind(direction_id),
            function(e){
              cb(e);
            }
          );
        }, function(e){
          if(e){
            cb(new Error('No stops found'), 'stops');
          } else {
            cb(null, 'stops');
          }
        });
    }
  },


  getStopsByDistance: function(lat, lon, radius, cb){
    //gets all stops within a radius

    if (_.isFunction(radius)) {
      cb = radius;
      radius = 1; //default is 1 mile
    }

    lat = parseFloat(lat);
    lon = parseFloat(lon);

    var radiusInDegrees = Math.round(radius/69*100000)/100000;

    Stop
      .where('loc')
      .near(lon, lat).maxDistance(radiusInDegrees)
      .exec(function(e, results){
        cb(e, results);
      });
  },

  getTimesByStop: function(agency_key, route_id, stop_id, direction_id, cb){
    var numOfTimes = 1000; //this is dumb but no calls to getTimesByStop() seem
    //to want to give it a numOfTimes argument. 1000 is probably at least 10x
    //more times than will be returned.
    
    
    //gets routes for one agency
    
    if (_.isFunction(direction_id)) {
      cb = direction_id;
      direction_id = null; //default is ~ 1/4 mile
    }

    var today = new Date()

      , service_ids = []
      , trip_ids = []
      , times = [];
    var today = new Date()
      , service_ids = []
      , trip_ids = []
      , times = [];

    var d = new Date();
    var utc = d.getTime() + (d.getTimezoneOffset() * 60000);
    var now = new Date(utc + (3600000*(-4)));
    var nowHour = now.getHours();
    var nowMinute = now.getMinutes();
    var nowSecond = now.getSeconds();
    var nowDispHour = (nowHour < 10) ? '0' + nowHour : nowHour;
    var nowDispMinute = (nowMinute < 10) ? '0' + nowMinute : nowMinute;
    var nowDispSecond = (nowSecond < 10) ? '0' + nowSecond : nowSecond;

    var currentTime = nowDispHour+':'+nowDispMinute+':'+nowDispSecond;

    //Find service_id that matches todays date
    async.series([
      checkFields,
      findServices,
      findTrips,
      findTimes
    ], function(e, results){
      if(e){
        cb(e,null);
      } else {
        cb(e, times);
      }
    });

    function checkFields(cb){
      if(!agency_key){
        cb(new Error('No agency_key specified'), 'fields');
      } else if(!stop_id){
        cb(new Error('No stop_id specified'), 'fields');
      } else if(!route_id){
        cb(new Error('No route_id specified'), 'fields');
      } else {
        cb(null, 'fields');
      }
    }

    function findServices(cb){
      var query = { agency_key: agency_key }
        , todayFormatted = utils.formatDay(today);
   
      //build query
      query[utils.getDayName(today).toLowerCase()] = 1;
  
      Calendar
        .find(query)
        .where('start_date').lte( todayFormatted )
        .where('end_date').gte( todayFormatted )
        .exec(function(e, services){
          if(services.length){
            services.forEach(function(service){
              service_ids.push(service.service_id);
            });
            cb(null, 'services');
          } else {
            cb(new Error('No Service for this date'), 'services');
          }
        });
    }

    function findTrips(cb){		
      var query = {
        agency_key: agency_key,
        route_id: route_id
      }
      
      if ((direction_id === 0) || (direction_id === 1)) {
		query.direction_id = direction_id;
	  } else {
		query["$or"] = [{direction_id:0},{direction_id:1}]
	  }		
      
      Trip
        .find(query)
        .where('service_id').in(service_ids)
        .exec(function(e, trips){
          if(trips.length){
            trips.forEach(function(trip){
              trip_ids.push(trip.trip_id);
            });
            cb(null, 'trips')
          } else {
            cb(new Error('No trips for this date'), 'trips');
          }
        });
    }
    
    function findTimes(cb){
      var query = {
          agency_key: agency_key,
          stop_id: stop_id
        }
        , timeFormatted = utils.timeToSeconds(today);
      
      StopTime
        .find(query)
        .where('trip_id').in(trip_ids)
        .sort('departure_time') //asc has been removed in favor of sort as of mongoose 3.x
        .limit(numOfTimes)
        .exec(function(e, stopTimes){
          if(stopTimes.length){
            stopTimes.forEach(function(stopTime){
              times.push(stopTime.departure_time);
            });
            cb(null, 'times');
          } else {
            cb(new Error('No times available for this stop on this date'), 'times');
          }
        });
      }
    },

    /*
    * Returns an object of {northData: "Headsign north", southData: "Headsign south"}
    */
    findBothDirectionNames: function(agency_key, route_id, cb) {
      var findDirectionName = function(agency_key, route_id, direction_id, cb) {
        var query = {
          agency_key: agency_key,
          route_id: route_id,
          direction_id: direction_id
        };
          
        Trip
          .find(query)
          .limit(1)
          .run(function(e, trips) {
            cb(trips[0].trip_headsign);
          });
        };

      findDirectionName(agency_key, route_id, 0, function(northData) {
        findDirectionName(agency_key, route_id, 1, function(southData) {
          var ret = {
            northData: northData,
            southData: southData
          };
          cb(ret);
        });
      });
    },

  getShapesByRoute: function(agency_key, route_id, direction_id, cb) {
    if (_.isFunction(direction_id)) {
      cb = direction_id;
      direction_id = null;
    }
    
    var shape_ids = [];
    var shapes = [];

    async.series([getShapeIds, getShapes], function(err, result) {
      cb(null, shapes);
    });

    function getShapeIds(cb) {   
      var query = {
        agency_key: agency_key,
        route_id: route_id
      }
      
      if ((direction_id === 0) || (direction_id === 1)) {
        query.direction_id = direction_id;
      } else {
        query["$or"] = [{direction_id:0},{direction_id:1}]
      }   
      
      Trip
        .find(query)
        .distinct('shape_id', function(err, results) {
          if (results.length) {
            shape_ids = results;
            cb(null, 'shape_ids');
          } else {
            cb(new Error('No trips with shapes.'), 'trips')
          }
        });
    }

    function getShapes(cb) {
      async.forEach(shape_ids, function(shape_id, cb) {
        Shape.find({
          agency_key: agency_key,
          shape_id: parseInt(shape_id, 10),
        }, function(err, shape_pts) {
          if(shape_pts.length) {
            shapes.push(shape_pts);
            cb(null, 'shape_pts');
          } else {
            cb(new Error('No shapes with shape_id.'), 'shape_pts')
          }
        });
      }, function(err) {
        cb(null, 'shapes');
      })
    }
  }
};

function handleError(e) {
  console.error(e || 'Unknown Error');
  process.exit(1)
};
