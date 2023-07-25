const utils = {

    getRoomForReceiver: receiver => {
        /*
        Get the right roomId for the given receiver from MATRIX_ROOMS configuration item.

        For is <receiver/roomId> separated by pipe for multiple receiver/rooms.
         */
        const roomConfigs = process.env.MATRIX_ROOMS.split('|')
        let roomId = false
        for (let config of roomConfigs) {
            const roomConfig = config.split('/')
            if (roomConfig[0] === receiver) {
                roomId = roomConfig[1]
                break
            }
        }
        return roomId
    },

    formatAlert: (data, externalURL) => {
        /*
        Format a single alert into a message string.
         */
        let parts = []

        let summary = ""
        if (data.annotations.hasOwnProperty("summary")) {
            summary = data.annotations.summary;
        } else if (data.labels.hasOwnProperty("alertname")) {
            summary = data.labels.alertname;
        }

        parts.push('<details>')

        let env = data.labels.env ? " (" + data.labels.env + ")" : ""

        if (data.status === 'firing') {
            if (process.env.MENTION_ROOM === "1") {
                parts.push('@room', '<br>')
            }
            let color = (function (severity) {
                switch (severity) {
                    case 'critical':
                        return '#E41227'; // red
                    case 'error':
                        return '#FF4507'; // orange
                    case 'warning':
                        return '#FFE608'; // yellow
                    case 'info':
                        return '#1661B8'; // blue
                    default:
                        return '#999999'; // grey
                }
            })(data.labels.severity);
            parts.push('<summary><strong><font color=\"' + color + '\">FIRING: ' + summary + env + '</font></strong></summary>')
        } else if (data.status === 'resolved') {
            parts.push('<summary><strong><font color=\"#33CC33\">RESOLVED: ' + summary + env + '</font></strong></summary>')
        } else {
            parts.push('<summary>' + data.status.toUpperCase() + ': ' + summary + env + '</summary>')
        }

        parts.push('<br />\n')

        Object.keys(data.labels).forEach((label) => {
            parts.push('<b>' + label + '</b>: ' + data.labels[label] + '<br>\n')
        });

        parts.push('<br />\n')

        Object.keys(data.annotations).forEach((annotation) => {
            if (annotation != "summary") {
                parts.push('<b>' + annotation + '</b>: ' + data.annotations[annotation] + '<br>\n')
            }
        })
        parts.push('</details>')
        parts.push('<br />\n')

        // link generation code
        let url = externalURL + data.generatorURL;
        if (process.env.GRAFANA_URL != "") {
            const left = {
                "datasource": process.env.GRAFANA_DATASOURCE,
                "queries": [
                    {
                        "refId": "A",
                        "expr": new URL(url).searchParams.get('g0.expr'),
                    }
                ],
                "range": { "from": "now-1h", "to": "now" }
            };
            url = process.env.GRAFANA_URL + "/explore?orgId=1&left=" + encodeURIComponent(JSON.stringify(left))
        }
        parts.push('<a href="', url, '">📈 Alert link</a>')

        let logs_url;
        if (!!process.env.GRAFANA_URL &&
            !!process.env.GRAFANA_LOKI_DATASOURCE) {

            let left;
            if (data.labels.hasOwnProperty("env") &&
                data.labels.hasOwnProperty("cluster_id") &&
                data.labels.hasOwnProperty("namespace") &&
                data.labels.hasOwnProperty("pod")) {

                // Chop off the "bc-" prefix
                const username = namespace.substring(3);

                left = {
                    "datasource": process.env.GRAFANA_LOKI_DATASOURCE,
                    "queries": [
                        {
                            "refId": "A",
                            "expr": `{env="${data.labels.env}",cluster_id="${data.labels.cluster_id}",username="${username}"} | unpack | pod="${data.labels.pod}"`,
                        }
                    ],
                    "range": { "from": "now-15m", "to": "now" }
                };
            } else if (data.labels.hasOwnProperty("env") &&
                data.labels.hasOwnProperty("cluster_id") &&
                data.labels.hasOwnProperty("nodename") &&
                data.labels.hasOwnProperty("exported_job") &&
                data.labels.hasOwnProperty("level")) {

                left = {
                    "datasource": process.env.GRAFANA_LOKI_DATASOURCE,
                    "queries": [
                        {
                            "refId": "A",
                            "expr": `{env="${data.labels.env}",cluster_id="${data.labels.cluster_id}",nodename="${data.labels.nodename}",job="${data.labels.exported_job}",level="${data.labels.level}"}`,
                        }
                    ],
                    "range": { "from": "now-15m", "to": "now" }
                };
            }

            if (!!left) {
                logs_url = process.env.GRAFANA_URL + "/explore?orgId=1&left=" + encodeURIComponent(JSON.stringify(left))
            }
        }

        if(data.annotations.hasOwnProperty("logs_url")) {
            logs_url = data.annotations.logs_url;
        }

        if (process.env.ALERTMANAGER_URL != "") {
            let filter = [];
            Object.keys(data.labels).forEach((label) => {
                filter.push(label + "=\"" + data.labels[label] + "\"");
            })
            let silenceUrl = process.env.ALERTMANAGER_URL + "/#/silences/new?filter={" + encodeURIComponent(filter.join(',')) + "}";
            parts.push('| <a href="' + silenceUrl + '">🔇 Silence</a>')
        }

        if(data.annotations.hasOwnProperty("runbook_url")) {
            parts.push('| <a href="', data.annotations.runbook_url, '">🏃 Runbook</a>')
        }

        if(logs_url) {
            parts.push('| <a href="', logs_url, '">🗒️ Logs</a>')
        }

        return parts.join(' ')
    },

    parseAlerts: data => {
        /*
        Parse AlertManager data object into an Array of message strings.
         */
        if (!data.alerts) {
            return []
        }

        console.log(JSON.stringify(data))

        let alerts = []

        data.alerts.forEach(alert => {
            alerts.push(utils.formatAlert(alert, data.externalURL))
        })
        return alerts
    },
}

module.exports = utils
