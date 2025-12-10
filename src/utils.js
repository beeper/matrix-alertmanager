const jsdiff = require('diff');

const segmentString = (string) => {
    return Array.from(string.matchAll(/[a-z0-9-]+|[^a-z0-9-]+/gi).map(match => match[0]));
}

const diffSegmented = (left, right) => {
    return jsdiff.diffArrays(segmentString(left), segmentString(right)).map(match => {
        match.value = match.value.join("");
        match.count = match.value.length;
        return match;
    });
}

const mergeStrings = (strings) => {
    if (!strings || strings.length === 0) {
        throw new Error(`No strings to merge!`);
    }

    if (strings.length === 1) {
        return strings[0];
    }

    // Take one string and diff it against all the other strings. This
    // will show us all the places where the strings differ from each
    // other.
    //
    // We'll actually diff the string against every string including
    // itself, the latter of which will give us an empty diff. This
    // will be helpful later as we won't have to treat the first
    // string as a special case.
    const diffs = [];
    for (const str of strings) {
        diffs.push(diffSegmented(strings[0], str));
    }

    // Go through each of the diffs sequentially. For each diff,
    // iterate through each character of the first string, and see
    // what happened to that character when the diff was applied. If
    // it remained unchanged, rather than being deleted or
    // substituted, we'll note that down. This will give us, for each
    // diff, a list of which characters from the first string were
    // left unchanged.
    const unchangedSets = [];
    for (const diff of diffs) {
        const unchanged = new Set();
        let ptr = 0;
        for (const edit of diff) {
            // We should advance ptr for either deletions or unchanged
            // sections. However, only the latter should be noted down
            // in our set for later.
            if (!edit.added) {
                for (let i = 0; i < edit.value.length; i++) {
                    if (!edit.removed) {
                        unchanged.add(ptr);
                    }
                    ptr += 1;
                }
            }
        }
        if (ptr !== strings[0].length) {
            throw new Error(`Diff didn't cover length of original string!`);
        }
        unchangedSets.push(unchanged);
    }

    // Now we have a set of unchanged characters from the original
    // string, one set for each diff. We compute a set intersection to
    // find which characters from the original string are unchanged in
    // every diff no matter what. We can use these as anchors so that
    // the only changes between the strings occur in between these
    // anchors.
    let unchangedCommon = unchangedSets[0];
    for (const unchanged of unchangedSets) {
        unchangedCommon = unchangedCommon.intersection(unchanged);
    }

    // This gives us a bag of integers, but what we really want is
    // ranges, to be easier to process. The computed ranges are
    // inclusive-exclusive, and we add one onto the iteration length
    // to neatly take care of ranges that end on the last character.
    let unchangedRanges = [];
    let rangeActive = false, rangeStart = -1;
    for (let ptr = 0; ptr < strings[0].length + 1; ptr++) {
        if (unchangedCommon.has(ptr) && !rangeActive) {
            rangeActive = true, rangeStart = ptr;
        } else if (!unchangedCommon.has(ptr) && rangeActive) {
            rangeActive = false, unchangedRanges.push({
                start: rangeStart,
                end: ptr,
            });
        }
    }

    // We'll also invert those ranges, to obtain the ranges that
    // represent the remaining characters that are different between
    // some of the strings, as opposed to the characters that are the
    // same between all of them. We add some fake ranges on to the
    // front and back to make the computation simpler in case there
    // are varying ranges at the front or back.
    let unchangedRangesAugmented = [
        {
            start: -1,
            end: 0,
        },
        ...unchangedRanges,
        {
            start: strings[0].length,
            end: strings[0].length + 1,
        },
    ];
    let varyingRanges = [];
    for (let i = 0; i < unchangedRangesAugmented.length - 1; i++) {
        let start = unchangedRangesAugmented[i].end;
        let end = unchangedRangesAugmented[i + 1].start;
        if (start !== end) {
            varyingRanges.push({ start, end });
        }
    }

    // Now that we have a list of character ranges that may vary in
    // each string, we can perform the same iteration through each
    // diff as before, except now collecting the actual character data
    // for those ranges.
    const varyingLists = [];
    for (const diff of diffs) {
        const chars = [];
        let ptr = 0;
        for (const edit of diff) {
            // Again we should only advance ptr for deletions or
            // unchanged sections. But now instead of just noting down
            // unchanged sections, we are also noting down additions.
            // We tag each section or character with the relevant
            // value of ptr, so that we can later filter to find out
            // whether it falls within one of the ranges we are
            // interested in.
            if (edit.added) {
                for (let i = 0; i < edit.value.length; i++) {
                    chars.push({
                        ptr: ptr,
                        value: edit.value[i],
                        countAdjacent: true,
                    });
                }
            } else {
                for (let i = 0; i < edit.value.length; i++) {
                    if (!edit.removed) {
                        chars.push({
                            ptr: ptr,
                            value: edit.value[i],
                            countAdjacent: false,
                        });
                    }
                    ptr += 1;
                }
            }
        }
        // Note that even though the ranges are inclusive-exclusive,
        // we are treating them as inclusive-inclusive here because we
        // want adjacent substrings to be picked up, as well.
        const varyingParts = [];
        let idx = 0, done = false;
        for (const range of varyingRanges) {
            if (chars[idx].ptr > range.end) {
                continue;
            }
            while (chars[idx].ptr < range.start) {
                idx += 1;
                if (idx >= chars.length) {
                    done = true;
                    break;
                }
            }
            if (done) {
                break;
            }
            let varyingPart = [];
            while (chars[idx].ptr <= range.end) {
                if (chars[idx].ptr < range.end || chars[idx].countAdjacent) {
                    varyingPart.push(chars[idx].value);
                }
                idx += 1;
                if (idx >= chars.length) {
                    done = true;
                    break;
                }
            }
            varyingParts.push(varyingPart.join(""));
            if (done) {
                break;
            }
        }
        varyingLists.push(varyingParts);
    }

    let varyingIdx = 0, unchangedIdx = 0;
    let onVarying = varyingRanges[0].start === 0;

    let combined = [];
    while (
        onVarying
        ? (varyingIdx < varyingRanges.length)
        : (unchangedIdx < unchangedRanges.length)
    ) {
        if (onVarying) {
            let variants = new Set();
            for (const list of varyingLists) {
                variants.add(list[varyingIdx]);
            }
            combined.push("{" + [...variants].sort().join(", ") + "}");

            varyingIdx += 1;
            onVarying = false;
        } else {
            const range = unchangedRanges[unchangedIdx];
            combined.push(strings[0].slice(range.start, range.end));

            unchangedIdx += 1;
            onVarying = true;
        }
    }

    return combined.join("");
}

const colorize = (color, msg) => {
    // Wrap it with two different ways of doing color, one of which
    // works on Desktop and one of which works on Android. Yes I know.
    return `<span data-mx-color="${color}"><font color="${color}">${msg}</font></span>`
}

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
            if (annotation != "summary" && !annotation.startsWith("logs_")) {
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

                left = {
                    "datasource": process.env.GRAFANA_LOKI_DATASOURCE,
                    "queries": [
                        {
                            "refId": "A",
                            "expr": `{env="${data.labels.env}",cluster_id="${data.labels.cluster_id}",namespace="${data.labels.namespace}",pod="${data.labels.pod}"}`,
                            "queryType": "range",
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
                            "queryType": "range",
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
        } else if (data.annotations.hasOwnProperty("logs_template")) {
            const now = new Date().getTime();
            const range_ms = (parseInt(data.annotations.logs_minutes) || 15) * 60 * 1000;

            const left = {
                "datasource": data.annotations.logs_datasource || "Loki Core",
                "queries": [{
                    "refId": "A",
                    "queryType": "range",
                    "expr": data.annotations.logs_template.replace(/\$([a-z0-9_]+)/g, function(_, label) {
                        return data.labels[label] || "";
                    }),
                }],
                "range": {
                    "from": (now - range_ms) + "",
                    "to": now + "",
                },
            };

            logs_url = process.env.GRAFANA_URL + "/explore?orgId=1&left=" + encodeURIComponent(JSON.stringify(left));
        }

        if (process.env.ALERTMANAGER_URL != "") {
            let filter = [];
            Object.keys(data.labels).forEach((label) => {
                filter.push(label + "=\"" + data.labels[label] + "\"");
            })
            let silenceUrl = process.env.ALERTMANAGER_URL + "/#/silences/new?filter={" + encodeURIComponent(filter.join(',')) + "}";
            parts.push('| <a href="' + silenceUrl + '">🔇 Silence</a>')
        }

        if(data.annotations.hasOwnProperty("dashboard_url")) {
            let url = data.annotations.dashboard_url.replace(/\$([a-z0-9_]+)/g, function(_, label) {
                return data.labels[label] || "";
            });

            parts.push('| <a href="', url, '">🚦 Dashboard</a>');
        }

        if(data.annotations.hasOwnProperty("runbook_url")) {
            parts.push('| <a href="', data.annotations.runbook_url, '">🏃 Runbook</a>')
        }

        if(logs_url) {
            parts.push('| <a href="', logs_url, '">🗒️ Logs</a>')
        }

        return parts.join(' ')
    },

    formatAlerts: data => {
        let parts = [];

        let statuses = new Set(data.alerts.map(alert => alert.status));
        for (const status of [...statuses].sort()) {
            const alerts = (
                data.alerts
                    .filter(alert => alert.status === status)
                    .map(alert => ({
                        ...alert, summary: alert.annotations.summary || alert.labels.alertname,
                    }))
            );

            let summary = mergeStrings(alerts.map(alert => alert.summary));

            let severities = new Set(alerts.map(alert => alert.labels.severity));

            let unknownEmoji = "🤨";
            let severityEmojis = {
                "critical": "💥",
                "error":    "🚨",
                "warning":  "⚠️",
                "info":     "ℹ️",
            };
            let statusEmojis = {
                "resolved": "✅",
            };
            let nbsp = " ";

            let summaryEmoji = "";
            for (const [severity, emoji] of Object.entries(severityEmojis)) {
                if (severities.has(severity)) {
                    summaryEmoji += emoji;
                }
            }
            if (statusEmojis[status]) {
                summaryEmoji = statusEmojis[status];
            }
            if (!summaryEmoji) {
                summaryEmoji = unknownEmoji;
            }

            parts.push(`<details>`);
            parts.push(`<summary><strong>`);
            parts.push(`${summaryEmoji} ${status.toUpperCase()}: ${summary}`);
            parts.push(`</strong></summary>`);

            for (const [label, value] of Object.entries(data.commonLabels)) {
                parts.push(` <br><b>${label}</b>: ${value}`);
            }

            let hasCommonAnnotation = false;
            for (const [annotation, value] of Object.entries(data.commonAnnotations)) {
                if (!hasCommonAnnotation) {
                    parts.push(`<br>`);
                    hasCommonAnnotation;
                }
                parts.push(` <br><b>${annotation}</b>: ${value}`);
            }

            if (alerts.length > 1) {
                parts.push(` <br>${nbsp}`);
                let alertNum = 1;
                for (const alert of alerts) {
                    const emoji = (
                        statusEmojis[alert.status] ||
                        severityEmojis[alert.labels.severity] ||
                        unknownEmoji
                    );
                    parts.push(`<details>`);
                    parts.push(`<summary><strong>`);
                    parts.push(`${emoji} ${alert.status.toUpperCase()}: ${alert.summary}`);
                    parts.push(`</strong></summary>`);
                    for (const [label, value] of Object.entries(alert.labels)) {
                        if (data.commonLabels[label]) continue;
                        parts.push(` <br><b>${label}</b>: ${value}`);
                    }
                    let hasAnnotation = false;
                    for (const [annotation, value] of Object.entries(alert.annotations)) {
                        if (data.commonAnnotations[annotation]) continue;
                        if (
                            annotation === "summary" ||
                            annotation.startsWith("logs_")
                        ) {
                            continue;
                        }
                        if (!hasAnnotation) {
                            parts.push(`<br>`);
                            hasAnnotation = true;
                        }
                        parts.push(` <br><b>${annotation}</b>: ${value}`);
                    }
                    parts.push(` <br>${nbsp}</details>`);
                    alertNum += 1;
                }
            }

            parts.push(`<br></details>`);
        }

        const urls = [];

        if (process.env.GRAFANA_URL && process.env.GRAFANA_DATASOURCE) {
            const generatorURLs = new Set(data.alerts.map(alert => alert.generatorURL));
            let grafanaNum = 1;
            for (const generatorURL of generatorURLs) {
                const alerts = data.alerts.filter(alert => alert.generatorURL == generatorURL);
                const relevantTimes = alerts.map(alert => new Date(alert.startsAt));
                relevantTimes.push(new Date());
                const minRelevant = Math.min.apply(null, relevantTimes),
                      maxRelevant = Math.max.apply(null, relevantTimes);
                const thirtyMinutesMs = 30 * 60 * 1000;
                const windowStarts = new Date(minRelevant - thirtyMinutesMs);
                const windowEnds = new Date(maxRelevant + thirtyMinutesMs);
                const left = {
                    datasource: process.env.GRAFANA_DATASOURCE,
                    queries: [{
                        refId: "A",
                        expr: new URL(`fake:${generatorURL}`).searchParams.get("g0.expr"),
                    }],
                    range: {
                        "from": windowStarts.toISOString(),
                        "to": windowEnds.toISOString(),
                    },
                };
                const url = (
                    process.env.GRAFANA_URL +
                    "/explore?orgId=1&left=" +
                    encodeURIComponent(JSON.stringify(left))
                );
                const name = generatorURLs.size > 1 ? `Alert query ${grafanaNum}` : "Alert query";
                urls.push(`<a href="${url}">📈 ${name}</a>`);
                grafanaNum += 1;
            }
        }

        if (process.env.ALERTMANAGER_URL) {
            let filter = Object.entries(data.commonLabels)
                               .map(([label, value]) => `${label}="${value}"`)
                               .join(",");
            const url = (
                process.env.ALERTMANAGER_URL +
                "/#/silences/new?filter={" +
                encodeURIComponent(filter) +
                "}"
            );
            urls.push(`<a href="${url}">🔇 Silence</a>`);
        }

        if (urls.length > 0) {
            parts.push(urls.join(" | "));
        }

        return parts.join("");
    },

    parseAlerts: data => {
        /*
        Parse AlertManager data object into an Array of message strings.
         */
        if (!data.alerts) {
            return []
        }

        console.log(JSON.stringify(data))

        if (process.env.RESPECT_GROUPBY === "1") {
            return [utils.formatAlerts(data)]
        }

        let alerts = []

        data.alerts.forEach(alert => {
            alerts.push(utils.formatAlert(alert, data.externalURL))
        })
        return alerts
    },
}

module.exports = utils
