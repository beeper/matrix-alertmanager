const client = require('./client')
const utils = require('./utils')

const routes = {
    getRoot: (req, res) => {
        res.send('Hey 👋')
    },
    postAlerts: async (req, res) => {
        let authorized = false;
        let expectedSecret = process.env.APP_ALERTMANAGER_SECRET;

        if (req.query.secret === expectedSecret) {
            authorized = true;
        }

        if (req.get('authorization') === `Bearer ${expectedSecret}`) {
            authorized = true;
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
            const promises = alerts.map(alert => client.sendAlert(roomId, alert))
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
