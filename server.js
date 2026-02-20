const express = require("express");
const ffmpeg = require("fluent-ffmpeg");
const axios = require("axios");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const path = require("path");

const app = express();
app.use(express.json());

const TMP_DIR = "/tmp";

async function downloadFile(url, filepath) {
  const writer = fs.createWriteStream(filepath);
  const response = await axios({
    url,
    method: "GET",
    responseType: "stream"
  });

  return new Promise((resolve, reject) => {
    response.data.pipe(writer);
    writer.on("finish", resolve);
    writer.on("error", reject);
  });
}

app.post("/merge", async (req, res) => {
  try {
    const { video1, video2, audio, hook } = req.body;

    if (!video1 || !video2 || !audio || !hook) {
      return res.status(400).json({
        error: "video1, video2, audio and hook are required"
      });
    }

    const id = uuidv4();

    const v1 = path.join(TMP_DIR, `${id}_v1.mp4`);
    const v2 = path.join(TMP_DIR, `${id}_v2.mp4`);
    const a1 = path.join(TMP_DIR, `${id}_a.mp3`);
    const output = path.join(TMP_DIR, `${id}_final.mp4`);

    // Download files (streamed)
    await downloadFile(video1, v1);
    await downloadFile(video2, v2);
    await downloadFile(audio, a1);

    ffmpeg()
      .input(v1)
      .input(v2)
      .input(a1)
      .complexFilter([
        "[0:v][1:v]concat=n=2:v=1:a=0[outv]"
      ])
      .outputOptions([
        "-map [outv]",
        "-map 2:a",
        "-preset ultrafast",
        "-crf 28",
        "-movflags +faststart",
        "-vf drawtext=text='" + hook.replace(/:/g, "\\:") + "':fontcolor=white:fontsize=48:x=(w-text_w)/2:y=100"
      ])
      .videoCodec("libx264")
      .audioCodec("aac")
      .on("end", () => {
        res.download(output, () => {
          // cleanup
          [v1, v2, a1, output].forEach(file => {
            if (fs.existsSync(file)) fs.unlinkSync(file);
          });
        });
      })
      .on("error", (err) => {
        console.error(err);
        res.status(500).json({ error: err.message });
      })
      .save(output);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Server running");
});
