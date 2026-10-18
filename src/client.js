const matrix = require('matrix-js-sdk')
const striptags = require('striptags')

let joinedRoomsCache = []

const client = {
    ensureInRoom: async function(roomId) {
        if (joinedRoomsCache.indexOf(roomId === -1)) {
            try {
                const room = await client.connection.joinRoom(roomId)
                if (room) {
                    joinedRoomsCache.push(room.roomId)
                }
            } catch (ex) {
                console.warn(`Could not join room ${roomId} - ${ex}`)
            }
        }
    },
    init: async function() {
        // Init Matrix client
        this.connection = matrix.createClient({
            baseUrl: process.env.MATRIX_HOMESERVER_URL,
            accessToken: process.env.MATRIX_TOKEN,
            userId: process.env.MATRIX_USER,
            localTimeoutMs: 30000,
        })

        // Ensure in right rooms
        const rooms = await this.connection.getJoinedRooms()
        const joinedRooms = rooms.joined_rooms
        const roomConfigs = process.env.MATRIX_ROOMS.split('|')
        roomConfigs.forEach(async roomConfig => {
            const room = roomConfig.split('/')
            if (joinedRooms.indexOf(room[1]) === -1) {
                await this.ensureInRoom(room[1])
            }
        })
    },
    sendAlert: async function(roomId, alert, mentions = []) {
        await this.ensureInRoom(roomId)
        const content = {
            'body': striptags(alert),
            'formatted_body': alert,
            'msgtype': 'm.text',
            'format': 'org.matrix.custom.html'
        }
        if (mentions.length > 0) {
            const pills = mentions.map(userId => `<a href="https://matrix.to/#/${userId}">${userId}</a>`)
            content['body'] = `${mentions.join(' ')}\n${content['body']}`
            content['formatted_body'] = `${pills.join(' ')}<br>${content['formatted_body']}`
            content['m.mentions'] = {'user_ids': mentions}
        }
        return this.connection.sendEvent(roomId, 'm.room.message', content, '')
    },
}

module.exports = client
