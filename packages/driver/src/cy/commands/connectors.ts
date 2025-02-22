import _ from 'lodash'
import Promise from 'bluebird'

import $dom from '../../dom'
import $utils from '../../cypress/utils'
import $errUtils from '../../cypress/error_utils'

const returnFalseIfThenable = (key, ...args): boolean => {
  if ((key === 'then') && _.isFunction(args[0]) && _.isFunction(args[1])) {
    // https://github.com/cypress-io/cypress/issues/111
    // if we're inside of a promise then the promise lib will naturally
    // pass (at least) two functions to another cy.then
    // this works similar to the way mocha handles thenables. for instance
    // in coffeescript when we pass cypress commands within a Promise's
    // .then() because the value is the cypress instance means that
    // the Promise lib will attach a new .then internally. it would never
    // resolve unless we invoked it immediately, so we invoke it and
    // return false then ensuring the command is not queued
    args[0]()

    return false
  }

  return true
}

const getFormattedElement = ($el) => {
  if ($dom.isElement($el)) {
    return $dom.getElements($el)
  }

  return $el
}

const upcomingAssertion = (next) => {
  if (!next || next.get('type') !== 'assertion') {
    return false
  }

  const arg = next.get('args')[0]

  return arg === 'not.exist' || arg === 'be.undefined' || arg === 'not.be.ok' || arg === 'be.null' || arg === 'eq' || arg === 'not.eq'
}

export default function (Commands, Cypress, cy, state) {
  // thens can return more "thenables" which are not resolved
  // until they're 'really' resolved, so naturally this API
  // supports nesting promises
  const thenFn = function (subject, userOptions, fn) {
    const ctx = state('ctx')

    if (_.isFunction(userOptions)) {
      fn = userOptions
      userOptions = {}
    }

    const options = _.defaults({}, userOptions, {
      timeout: Cypress.config('defaultCommandTimeout'),
    })

    // clear the timeout since we are handling
    // it ourselves
    cy.clearTimeout()

    // TODO: use subject from state("subject")

    const remoteSubject = cy.getRemotejQueryInstance(subject)

    let hasSpreadArray

    try {
      hasSpreadArray = subject && subject._spreadArray
    } catch (error) {} // eslint-disable-line no-empty

    let args = remoteSubject || subject

    args = hasSpreadArray ? args : [args]

    // name could be invoke or its!
    const name = state('current').get('name')

    const cleanup = () => {
      state('onInjectCommand', undefined)
      cy.removeListener('command:enqueued', enqueuedCommand)

      return null
    }

    let invokedCyCommand = false

    const enqueuedCommand = () => {
      invokedCyCommand = true

      return invokedCyCommand
    }

    state('onInjectCommand', returnFalseIfThenable)

    cy.once('command:enqueued', enqueuedCommand)

    const getRet = () => {
      let ret = fn.apply(ctx, args)

      if (ret && invokedCyCommand && !ret.then) {
        $errUtils.throwErrByPath('then.callback_mixes_sync_and_async', {
          onFail: options._log,
          args: { value: $utils.stringify(ret) },
        })
      }

      return ret
    }

    return Promise
    .try(getRet)
    .timeout(options.timeout)
    .then((ret) => {
      // if ret is undefined then
      // resolve with the existing subject
      if (_.isUndefined(ret)) {
        return subject
      }

      // If the user callback returned a non-null value, we break cypress' subject chaining
      // logic, so that we can use this subject as-is rather than the subject generated by
      // any chainers inside the callback (if any exist).
      cy.breakSubjectLinksToCurrentChainer()

      return ret
    }).catch(Promise.TimeoutError, () => {
      return $errUtils.throwErrByPath('invoke_its.timed_out', {
        onFail: options._log,
        args: {
          cmd: name,
          timeout: options.timeout,
          func: fn.toString(),
        },
      })
    })
    .finally(cleanup)
  }

  // to allow the falsy value 0 to be used
  const isPath = (str) => (!!str || str === 0)

  Commands.addQuery('its', function its (path, options: Partial<Cypress.Loggable & Cypress.Timeoutable> = {}, ...args) {
    // If we're being used in .invoke(), we us it. For any other current command (.its itself or a custom command),
    // we fall back to the .its() error messages.
    const cmd = this.get('name') === 'invoke' ? 'invoke' : 'its'

    Cypress.ensure.isChildCommand(this, arguments, cy)

    if (args.length) {
      $errUtils.throwErrByPath('invoke_its.invalid_num_of_args', { args: { cmd } })
    }

    if (!_.isObject(options)) {
      $errUtils.throwErrByPath('invoke_its.invalid_options_arg', { args: { cmd } })
    }

    if (!isPath(path)) {
      $errUtils.throwErrByPath('invoke_its.null_or_undefined_property_name', {
        args: { cmd, identifier: 'property' },
      })
    }

    if (!_.isString(path) && !_.isNumber(path)) {
      $errUtils.throwErrByPath('invoke_its.invalid_prop_name_arg', {
        args: { cmd, identifier: 'property' },
      })
    }

    const log = this.get('_log') || (options.log !== false && Cypress.log({
      message: `.${path}`,
      timeout: options.timeout,
    }))

    this.set('timeout', options.timeout)
    this.set('ensureExistenceFor', 'subject')

    return (subject) => {
      if (subject == null) {
        $errUtils.throwErrByPath(`${cmd}.subject_null_or_undefined`, {
          args: { prop: path, cmd, value: subject },
        })
      }

      subject = cy.getRemotejQueryInstance(subject) || subject

      const value = _.get(subject, path)

      log && cy.state('current') === this && log.set({
        $el: $dom.isElement(subject) ? subject : null,
        consoleProps () {
          const obj = {
            Property: `.${path}`,
            Subject: subject,
            Yielded: getFormattedElement(value),
          }

          return obj
        },
      })

      if (value == null && !upcomingAssertion(this.get('next'))) {
        if (!_.has(subject, path)) {
          $errUtils.throwErrByPath('invoke_its.nonexistent_prop', { args: { cmd, prop: path, value } })
        }

        $errUtils.throwErrByPath(`${cmd}.null_or_undefined_prop_value`, { args: { prop: path, value } })
      }

      return value
    }
  })

  Commands.addQuery('invoke', function invoke (optionsOrPath, argOrOptions, ...args) {
    let options
    let path

    if (_.isString(optionsOrPath) || _.isNumber(optionsOrPath)) {
      options = {}
      path = optionsOrPath
      if (arguments.length > 1) {
        args.unshift(argOrOptions)
      }
    } else {
      options = optionsOrPath
      path = argOrOptions
    }

    if (!_.isString(path) && !_.isNumber(path)) {
      if (path == null && _.isObject(options) && !_.isFunction(options)) {
        $errUtils.throwErrByPath('invoke_its.null_or_undefined_property_name', { args: {
          cmd: 'invoke',
          identifier: 'function',
        } })
      }

      $errUtils.throwErrByPath('invoke_its.invalid_prop_name_arg', { args: {
        cmd: 'invoke',
        identifier: 'function',
      } })
    }

    const log = options.log !== false && Cypress.log({
      message: `.${path}()`,
      timeout: options.timeout,
    })

    this.set('_log', log)

    const itsFn = cy.now('its', path, options)

    // .its() has an implicit assertions that the return value shouldn't be null, but
    // .invoke() has no such requirement. Removing ensureExistenceFor resests implicit
    // assertion that .its() added
    this.set('ensureExistenceFor', null)

    return (subject) => {
      subject = cy.getRemotejQueryInstance(subject) || subject

      // We use its for its validation, even though we ignore the returned value.
      itsFn(subject)

      const pathParts = path.toString().split('.')
      const last = pathParts.pop()
      const parent = pathParts.length === 0 ? subject : _.get(subject, pathParts)

      if (!_.isFunction(parent[last])) {
        $errUtils.throwErrByPath('invoke.prop_not_a_function', { args: {
          prop: path,
          type: $utils.stringifyFriendlyTypeof(parent[last]),
        } })
      }

      let value = parent[last](...args)

      log && cy.state('current') === this && log.set({
        $el: $dom.isElement(subject) ? subject : null,
        consoleProps: () => {
          return {
            name: 'invoke',
            Function: `.${path}(${$utils.stringify(args)})`,
            Subject: subject,
            'With Arguments': args,
            Yielded: value,
          }
        },
      })

      return value
    }
  })

  Commands.addAll({ prevSubject: true }, {
    spread (subject, options, fn) {
      // if this isnt an array-like blow up right here
      if (!_.isArrayLike(subject)) {
        $errUtils.throwErrByPath('spread.invalid_type')
      }

      subject._spreadArray = true

      return thenFn(subject, options, fn)
    },

    each (subject, options, fn) {
      let userOptions = options
      const ctx = this

      if (_.isUndefined(fn)) {
        fn = userOptions
        userOptions = {}
      }

      if (!_.isFunction(fn)) {
        $errUtils.throwErrByPath('each.invalid_argument')
      }

      if (subject?.length === undefined) {
        return $errUtils.throwErrByPath('each.non_array', {
          args: { subject: $utils.stringify(subject) },
        })
      }

      if (subject.length === 0) {
        return subject
      }

      let endEarly = false

      const yieldItem = (el, index) => {
        if (endEarly) {
          return
        }

        if ($dom.isElement(el)) {
          el = $dom.wrap(el)
        }

        const callback = () => {
          const ret = fn.call(ctx, el, index, subject)

          // if the return value is false then return early
          if (ret === false) {
            endEarly = true
          }

          return ret
        }

        return thenFn(el, userOptions, callback)
      }

      // generate a real array since bluebird is finicky and
      // doesnt want an 'array-like' structure like jquery instances
      return Promise
      .each(_.toArray(subject), yieldItem)
      .then(() => {
        // cy.each does *not* want to use any subjects that the user's callback generated - therefore we break
        // cypress' subject chaining logic, which by default would override this with any subjects generated by
        // the callback function.
        cy.breakSubjectLinksToCurrentChainer()

        return subject
      })
    },
  })

  Commands.addAll({ prevSubject: 'optional' }, {
    then (subject, userOptions, fn) {
      // eslint-disable-next-line prefer-rest-params
      return thenFn.apply(this, [subject, userOptions, fn])
    },
  })
}
