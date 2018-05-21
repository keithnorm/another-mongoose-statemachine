'use strict';

var _ = require("lodash");
var Promise = require('bluebird');

function applyDefaultValue(states) {
  Object.keys(states).forEach((state, i) => {
    states[state].value = i;
  });
}

module.exports = function (schema, options) {
  var states = options.states;
  var transitions = options.transitions;
  var stateNames = _.keys(states);
  var transitionNames = _.keys(transitions);
  var fieldName = options.fieldName || 'state';

  var defaultStateName = getDefaultState(states);
  var defaultState = states[defaultStateName];

  var stateSchema = {};
  stateSchema[fieldName] = {
    type: String,
    enum: stateNames,
    default: defaultStateName,
    set: function(val) {
      this[`${fieldName}Value`] = states[val].value;
      return val;
    }
  };
  schema.add(stateSchema);

  if (!defaultState.value) {
    applyDefaultValue(states);
  }

  var stateValueSchema = {};
  stateValueSchema[`${fieldName}Value`] = {
    type: Number,
    default: defaultState.value 
  };
  schema.add(stateValueSchema);
  schema.statics.getStateValue = function(stateName) {
    return states[stateName].value;
  };

  var transitionMethods = {};
  var transitionStatics = {};
  transitionNames.forEach(function(t) {
    transitionMethods[t] = transitionize(t);
    transitionStatics[t] = staticTransitionize(t);
  });
  schema.method(transitionMethods);
  schema.static(transitionStatics);


  function transitionize(t) {
    return function(callback) {
      var Model = this.constructor;
      return Model[t].call(Model, this, callback);
    };
  }

  function staticTransitionize(transitionName) {
    return function(id, callback) {
      var Model = this;
      var transition = transitions[transitionName];
      var enter = states[transition.to].enter;
      var behavior = transition.behavior;
      // stateA -> stateA ...
      var stateChanged = false;
      var query = {};
      var instance;
      var transitionHappend;
      var toStateValue;
      var from;
      var exit;

      if(_.has(defaultState, 'value')) {
        toStateValue = states[transition.to].value;
      }

      if(_.isString(transition.from)) {
        if('*' !== transition.from) {
          query[`${fieldName}Value`] = states[transition.from].value;
        }
      } else if(_.isArray(transition.from)) {
        var fromValues = _.map(transition.from, function(from) { return states[from].value; });
        query[`${fieldName}Value`] = { $in: fromValues };
      }


      query._id = id;

      if (id instanceof Model) {
        instance = id;
        query._id = id._id;
      }

      return (new Promise(function(resolve, reject) {
        console.log('FIND ONE', query);
        Model.findOne(query).exec(function(err, item) {
          if(err) {
            return reject(err);
          }
          if(!item) {
            return reject(new Error('found null'));
          }

          var update = {
            [fieldName]: transition.to,
            [`${fieldName}Value`]: states[transition.to].value
          };

          transitionHappend = true;
          stateChanged = item[fieldname] !== transition.to;
          from = item[fieldName];
          exit = states[from].exit;

          query[`${fieldName}Value`] = states[from].value;
          Model.update(query, update).exec(function(err, r) {
            if (err) {
              return reject(err);
            }

            instance = instance || item;
            instance[fieldName] = update[fieldName];
            instance[`${fieldName}Value`] = update[`${fieldName}Value`];
            resolve(r);
          });
        });
      })).then(function(result) {

        if(result.n === 0) {
          return Promise.reject(new Error('state not changed'));
        }

        var callbacks = [];

        if(behavior && transitionHappend) {
          callbacks.push(behavior.call(instance));
        }
        if(result.nModified > 0) {
          if(exit && stateChanged) { callbacks.push(exit.call(instance)); }
          if(enter && stateChanged) { callbacks.push(enter.call(instance)); }
        }

        return Promise.all(callbacks);
      }).nodeify(callback);
    };
  }
};


function getDefaultState(states) {
  var stateNames = _.keys(states);
  var selected = _.filter(stateNames, function(s) {
    return !!states[s].default;
  });
  return selected[0] || stateNames[0];
}
