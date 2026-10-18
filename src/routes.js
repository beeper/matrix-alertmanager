const client = require('./client')
const utils = require('./utils')

const crypto = require('crypto')

const passwordsEqual = (a, b) => {
    return a && b && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

const routes = {
    getRoot: (req, res) => {
        res.send('Hey 👋')
    },
    postAlerts: async (req, res) => {
        let authorized = false
        let expectedSecret = process.env.APP_ALERTMANAGER_SECRET

        if (!expectedSecret) {
            console.error("APP_ALERTMANAGER_SECRET is not configured, unable to authenticate requests")
            res.status(500).end()
            return
        }

        if (passwordsEqual(req.query.secret, expectedSecret)) {
            authorized = true
        }

        if (passwordsEqual(req.get('authorization'), `Bearer ${expectedSecret}`)) {
            authorized = true
        }

        if (!authorized) {
            res.status(403).end()
            return
        }

        const alerts = utils.parseAlerts(req.body)

        if (!alerts) {
            console.warn("received request with no alerts in payload")
            res.json({'result': 'no alerts found in payload'})
            return
        }

        const roomId = utils.getRoomForReceiver(req.body.receiver)
        if (!roomId) {
            console.warn(`received request for unconfigured receiver ${req.body.receiver}`)
            res.json({'result': 'no rooms configured for this receiver'})
            return
        }

        try {
            const mentions = utils.getMentionsForReceiver(req.body.receiver)
            const statuses = process.env.RESPECT_GROUPBY === "1" ? [req.body.status] : req.body.alerts.map(alert => alert.status)
            const promises = alerts.map((alert, i) => client.sendAlert(roomId, alert, statuses[i] === 'firing' ? mentions : []))
            await Promise.all(promises)
            res.json({'result': 'ok'})
        } catch (e) {
            // eslint-disable-next-line no-console
            console.error(e)
            res.status(500)
            res.json({'result': 'error'})
        }
    },
}

module.exports = routes
