const { performance } = require("perf_hooks");
const fs = require("fs");
const path = require("path");

const BASE_URL = "https://zookeeper.stanford.edu:9443/";
const TEST_COMMENT = "TEST COMMENT";
const TEST_TRACK = "TEST TRACK";
const TEST_NAME = "TEST Show";
const TEST_AIRNAME = "KZSU Music Beatcheck";
const API_KEY = process.env.APIKEY;

const logPath = path.join(__dirname, "..", "metrics", "metrics.csv");
let paginateSeq = 1;

function paginateUrl(url) {
  return url.replace(/\/v1(\.\d+)?\//, `/v1.${paginateSeq++}/`);
}

async function safeText(res) {
  try {
    return await res.text();
  } catch (e) {
    return "<failed-to-read-body>";
  }
}

(async () => {
  try {
    // Ensure metrics directory exists
    fs.mkdirSync(path.dirname(logPath), { recursive: true });

    const timestamp = new Date().toISOString();
    const durations = {
      findTime: 0,
      createTime: 0,
      commentTime: 0,
      spinTime: 0,
      moveTime: 0,
      viewTime: 0,
      deleteCommentTime: 0,
      deleteSpinTime: 0,
    };

    let pid, list, cid, sid;

    // 1. Find Playlist
    let t0 = performance.now();
    let res = await fetch(`${BASE_URL}api/v1/playlist?filter[user]=self&fields[show]=name`, {
      method: "GET",
      headers: { "X-APIKEY": API_KEY }
    });
    let t1 = performance.now();
    durations.findTime = t1 - t0;
    if (!res.ok) {
      const body = await safeText(res);
      throw new Error(`Find playlist failed: ${res.status} ${body}`);
    }

    const shows = await res.json();
    const match = shows.data.find(show => show.attributes.name === TEST_NAME);
    if (match) {
      pid = match.id;
      list = `api/v1/playlist/${pid}`;
    } else {
      // 1b. Create Playlist
      t0 = performance.now();
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
      t1 = performance.now();
      durations.createTime = t1 - t0;
      if (res.status !== 201) {
        const body = await safeText(res);
        throw new Error(`Create playlist failed: ${res.status} ${body}`);
      }

      list = res.headers.get("location");
      pid = list.split("/").pop();
    }

    // 2. Insert Comment
    t0 = performance.now();
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
    t1 = performance.now();
    durations.commentTime = t1 - t0;
    const json2 = await res.json().catch(() => ({}));
    if (!res.ok || !json2?.data?.id) {
      const body = await safeText(res);
      throw new Error(`Insert comment failed: ${res.status} ${body}`);
    }
    cid = json2.data.id;

    // 3. Insert Spin
    t0 = performance.now();
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
    t1 = performance.now();
    durations.spinTime = t1 - t0;
    const json3 = await res.json().catch(() => ({}));
    if (!res.ok || !json3?.data?.id) {
      const body = await safeText(res);
      throw new Error(`Insert spin failed: ${res.status} ${body}`);
    }
    sid = json3.data.id;

    // 4. Move Track
    t0 = performance.now();
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
          meta: {
            moveTo: cid
          }
        }
      })
    });
    t1 = performance.now();
    durations.moveTime = t1 - t0;
    if (res.status !== 204) {
      const body = await safeText(res);
      throw new Error(`Move track failed: ${res.status} ${body}`);
    }

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
    durations.viewTime = t1 - t0;
    if (!res.ok) {
      const body = await safeText(res);
      throw new Error(`View playlist failed: ${res.status} ${body}`);
    }
    const page = await res.text();
    const commentPos = page.indexOf(TEST_COMMENT);
    const trackPos = page.indexOf(TEST_TRACK);
    if (!(commentPos > trackPos && commentPos !== -1 && trackPos !== -1)) {
      throw new Error("Validation failed: comment was not after track in playlist HTML view");
    }

    // 6. Delete Comment
    t0 = performance.now();
    res = await fetch(`${BASE_URL}${paginateUrl(list)}/events`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/vnd.api+json",
        "X-APIKEY": API_KEY
      },
      body: JSON.stringify({
        data: {
          type: "event",
          id: cid
        }
      })
    });
    t1 = performance.now();
    durations.deleteCommentTime = t1 - t0;
    if (res.status !== 204) {
      const body = await safeText(res);
      throw new Error(`Delete comment failed: ${res.status} ${body}`);
    }

    // 7. Delete Spin
    t0 = performance.now();
    res = await fetch(`${BASE_URL}${paginateUrl(list)}/events`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/vnd.api+json",
        "X-APIKEY": API_KEY
      },
      body: JSON.stringify({
        data: {
          type: "event",
          id: sid
        }
      })
    });
    t1 = performance.now();
    durations.deleteSpinTime = t1 - t0;
    if (res.status !== 204) {
      const body = await safeText(res);
      throw new Error(`Delete spin failed: ${res.status} ${body}`);
    }

    // Total time
    const totalTime = Object.values(durations).reduce((sum, val) => sum + val, 0);

    // Write to CSV
    const header = "timestamp,findTime,createTime,commentTime,spinTime,moveTime,viewTime,deleteCommentTime,deleteSpinTime,totalTime";
    const row = `${timestamp},${durations.findTime.toFixed(2)},${durations.createTime.toFixed(2)},${durations.commentTime.toFixed(2)},${durations.spinTime.toFixed(2)},${durations.moveTime.toFixed(2)},${durations.viewTime.toFixed(2)},${durations.deleteCommentTime.toFixed(2)},${durations.deleteSpinTime.toFixed(2)},${totalTime.toFixed(2)}`;

    if (!fs.existsSync(logPath)) {
      fs.writeFileSync(logPath, `${header}\n`);
    }
    fs.appendFileSync(logPath, `${row}\n`);

    console.log("Metrics appended:", row);
  } catch (err) {
    console.error("Script failed:", err && err.stack ? err.stack : err);
    // Exit non-zero so the workflow run fails and you can inspect logs
    process.exit(1);
  }
})();
