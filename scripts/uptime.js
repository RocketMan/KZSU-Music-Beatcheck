const fetch = require("node-fetch");
const { performance } = require("perf_hooks");

const BASE_URL = "https://zookeeper.stanford.edu:9443/";
const TEST_COMMENT = "TEST COMMENT";
const TEST_TRACK = "TEST TRACK";
const TEST_NAME = "TEST Show";
const TEST_AIRNAME = "KZSU Music Beatcheck";
const API_KEY = process.env.APIKEY;

let paginateSeq = 1;

/**
 * perturb the URL to avoid tripping DoS countermeasures
 *
 * useful for rapid requests to the same URL
 */
function paginateUrl(url) {
    return url.replace(/\/v1(\.\d+)?\//, `/v1.${paginateSeq++}/`);
}


(async () => {
    const start = performance.now();
    try {
        let pid, list, cid, sid;

        // 1. Find or Create Playlist
        let res = await fetch(`${BASE_URL}api/v1/playlist?filter[user]=self&fields[show]=name`, {
            method: "GET",
            headers: { "X-APIKEY": API_KEY }
        });
        if (!res.ok) throw new Error("Find playlist failed");
        const shows = await res.json();
        const match = shows.data.find(show => show.attributes.name === TEST_NAME);
        if (match) {
            pid = match.id;
            list = `${BASE_URL}api/v1/playlist/${pid}`;
        } else {
            res = await fetch(`${BASE_URL}api/v1/playlist`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/vnd.api+json",
                    "X-APIKEY": API_KEY
                },
                body: JSON.stringify({
                    data: {
                        type: "show",
                        attributes: {
                            name: TEST_NAME,
                            date: "2020-01-01",
                            time: "1200-1400",
                            airname: TEST_AIRNAME
                        }
                    }
                })
            });
            if (res.status !== 201) throw new Error("Create playlist failed");
            list = res.headers.get("location");
            pid = list.split("/").pop();
        }

        // 2. Insert Comment
        res = await fetch(`${BASE_URL}${paginateUrl(list)}/events`, {
            method: "POST",
            headers: {
                "Content-Type": "application/vnd.api+json",
                "X-APIKEY": API_KEY
            },
            body: JSON.stringify({
                data: {
                    type: "event",
                    attributes: {
                        type: "comment",
                        comment: TEST_COMMENT
                    }
                }
            })
        });
        const json2 = await res.json();
        if (!res.ok || !json2?.data?.id) throw new Error("Insert comment failed");
        cid = json2.data.id;

        // 3. Insert Spin
        res = await fetch(`${BASE_URL}${paginateUrl(list)}/events`, {
            method: "POST",
            headers: {
                "Content-Type": "application/vnd.api+json",
                "X-APIKEY": API_KEY
            },
            body: JSON.stringify({
                data: {
                    type: "event",
                    attributes: {
                        type: "spin",
                        artist: "TEST, Artist",
                        album: "TEST Album",
                        track: TEST_TRACK,
                        label: "TEST Label"
                    }
                }
            })
        });
        const json3 = await res.json();
        if (!res.ok || !json3?.data?.id) throw new Error("Insert spin failed");
        sid = json3.data.id;

        // 4. Move Track
        res = await fetch(`${BASE_URL}${paginateUrl(list)}/events`, {
            method: "PATCH",
            headers: {
                "Content-Type": "application/vnd.api+json",
                "X-APIKEY": API_KEY
            },
            body: JSON.stringify({
                data: {
                    type: "event",
                    id: sid,
                    meta: { moveTo: cid }
                }
            })
        });
        if (res.status !== 204) throw new Error("Move track failed");

        // 5. View Playlist
        res = await fetch(`${BASE_URL}?action=&subaction=viewListById&playlist=${pid}`, {
            method: "GET",
            headers: {
                "Accept": "text/html",
                "X-APIKEY": API_KEY
            }
        });
        const page = await res.text();
        const commentPos = page.indexOf(TEST_COMMENT);
        const trackPos = page.indexOf(TEST_TRACK);
        if (!(commentPos > trackPos && commentPos !== -1 && trackPos !== -1)) {
            throw new Error("View playlist failed");
        }

        // 6. Delete Comment
        res = await fetch(`${BASE_URL}${paginateUrl(list)}/events`, {
            method: "DELETE",
            headers: {
                "Content-Type": "application/vnd.api+json",
                "X-APIKEY": API_KEY
            },
            body: JSON.stringify({
                data: { type: "event", id: cid }
            })
        });
        if (res.status !== 204) throw new Error("Delete comment failed");

        // 7. Delete Spin
        res = await fetch(`${BASE_URL}${paginateUrl(list)}/events`, {
            method: "DELETE",
            headers: {
                "Content-Type": "application/vnd.api+json",
                "X-APIKEY": API_KEY
            },
            body: JSON.stringify({
                data: { type: "event", id: sid }
            })
        });
        if (res.status !== 204) throw new Error("Delete spin failed");

        const end = performance.now();
        console.log(`response_time ${(end - start).toFixed(2)}`);
        process.exit(0);
    } catch (err) {
        console.error("Probe failed:", err.message);
        process.exit(1);
    }
})();

