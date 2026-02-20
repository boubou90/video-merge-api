const express = require("express");
const ffmpeg = require("fluent-ffmpeg");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const app = express();
app.use(express.json());

const TMP_DIR = "/tmp";

async function downloadFile(url, filepath) {
  const writer = fs.createWriteStream(filepath);
  const response = await axios({
    url,
    method: "GET",
    responseType: "stream",
    timeout: 60000
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
    const textFile = path.join(TMP_DIR, `${id}_text.txt`);
    const output = path.join(TMP_DIR, `${id}_final.mp4`);

    console.log("Downloading files...");
    await downloadFile(video1, v1);
    await downloadFile(video2, v2);
    await downloadFile(audio, a1);

    fs.writeFileSync(textFile, hook);

    console.log("Running lightweight ffmpeg...");

    ffmpeg()
      .input(v1)
      .input(v2)
      .input(a1)
      .complexFilter([
        {
          filter: "concat",
          options: { n: 2, v: 1, a: 0 },
          inputs: ["0:v", "1:v"],
          outputs: "vout"
        },
        {
          filter: "drawtext",
          options: {
            fontfile: "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            textfile: textFile,
            fontcolor: "white",
            fontsize: 50,
            borderw: 2,
            bordercolor: "black",
            x: "(w-text_w)/2",
            y: "100"
          },
          inputs: "vout",
          outputs: "vfinal"
        }
      ])
      .outputOptions([
        "-map [vfinal]",
        "-map 2:a",
        "-shortest",
        "-preset ultrafast",
        "-crf 30",
        "-movflags +faststart",
        "-threads 1"
      ])
      .videoCodec("libx264")
      .audioCodec("aac")
      .audioBitrate("128k")
      .on("end", () => {
        console.log("Done");

        res.json({
          success: true,
          id,
          downloadUrl: `/download/${id}`
        });

        [v1, v2, a1, textFile].forEach(file => {
          if (fs.existsSync(file)) fs.unlinkSync(file);
        });
      })
      .on("error", err => {
        console.error(err);
        res.status(500).json({ error: err.message });
      })
      .save(output);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/download/:id", (req, res) => {
  const filePath = path.join(TMP_DIR, `${req.params.id}_final.mp4`);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File not found" });
  }

  res.download(filePath, () => {
    fs.unlinkSync(filePath);
  });
});

app.listen(process.env.PORT || 10000, () => {
  console.log("Server running");
});
