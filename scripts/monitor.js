const fetch = require("node-fetch");
const { performance } = require("perf_hooks");

const BASE_URL = "https://zookeeper.stanford.edu/";
const TEST_COMMENT = "TEST COMMENT";
const TEST_TRACK = "TEST TRACK";
const TEST_NAME = "TEST Show";
const TEST_AIRNAME = "KZSU Music Beatcheck";
const API_KEY = process.env.APIKEY;

(async () => {
    const log = (label, success, duration) =>
	  console.log(`${label}: ${success ? "✅" : "❌"} (${duration.toFixed(2)}ms)`);

    let pid, list, cid, sid;

    // 1. Create Playlist
    let t0 = performance.now();
    let res = await fetch(`${BASE_URL}api/v1/playlist`, {
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
    let t1 = performance.now();
    const success1 = res.status === 201;
    log("Create playlist", success1, t1 - t0);
    if (!success1) return;

    list = res.headers.get("location");
    pid = list.split("/").pop();

    // 2. Insert Comment
    t0 = performance.now();
    res = await fetch(`${BASE_URL}${list}/events`, {
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
    t1 = performance.now();
    const json2 = await res.json();
    const success2 = res.status === 200 && json2?.data?.id;
    log("Insert comment", success2, t1 - t0);
    if (!success2) return;
    cid = json2.data.id;

    // 3. Insert Spin
    t0 = performance.now();
    res = await fetch(`${BASE_URL}${list}/events`, {
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
    t1 = performance.now();
    const json3 = await res.json();
    const success3 = res.status === 200 && json3?.data?.id;
    log("Insert spin", success3, t1 - t0);
    if (!success3) return;
    sid = json3.data.id;

    // 4. Move Track
    t0 = performance.now();
    res = await fetch(`${BASE_URL}${list}/events`, {
	method: "PATCH",
	headers: {
	    "Content-Type": "application/vnd.api+json",
	    "X-APIKEY": API_KEY
	},
	body: JSON.stringify({
	    data: {
		type: "event",
		id: sid,
		meta: {
		    moveTo: cid
		}
	    }
	})
    });
    t1 = performance.now();
    const success4 = res.status === 204;
    log("Move track", success4, t1 - t0);
    if (!success4) return;

    // 5. View Playlist
    t0 = performance.now();
    res = await fetch(`${BASE_URL}?action=&subaction=viewListById&playlist=${pid}`, {
	method: "GET",
	headers: {
	    "Accept": "text/html",
	    "X-APIKEY": API_KEY
	}
    });
    t1 = performance.now();
    const page = await res.text();
    const commentPos = page.indexOf(TEST_COMMENT);
    const trackPos = page.indexOf(TEST_TRACK);
    const success5 = commentPos > trackPos && commentPos !== -1 && trackPos !== -1;
    log("View playlist", success5, t1 - t0);

    // 6. Delete Playlist
    t0 = performance.now();
    res = await fetch(`${BASE_URL}${list}`, {
	method: "DELETE",
	headers: {
	    "X-APIKEY": API_KEY
	}
    });
    t1 = performance.now();
    const success6 = res.status === 204;
    log("Delete playlist", success6, t1 - t0);
})();
