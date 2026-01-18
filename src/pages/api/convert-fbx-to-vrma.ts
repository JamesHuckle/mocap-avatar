import type {NextApiRequest, NextApiResponse} from 'next';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {spawn} from 'child_process';
import formidable, {File as FormidableFile} from 'formidable';

export const config = {
  api: {
    bodyParser: false,
  },
};

function parseForm(req: NextApiRequest): Promise<{file: FormidableFile}> {
  const form = formidable({
    multiples: false,
    keepExtensions: true,
  });

  return new Promise((resolve, reject) => {
    form.parse(req, (err, _fields, files) => {
      if (err) return reject(err);
      const file = (files.file as FormidableFile | FormidableFile[] | undefined) ?? undefined;
      if (!file) return reject(new Error('Missing file field "file"'));
      // Some formidable versions still return an array even with `multiples: false`.
      // Accept the first item for robustness.
      if (Array.isArray(file)) {
        if (file.length === 0) return reject(new Error('Missing file field "file"'));
        return resolve({file: file[0]});
      }
      return resolve({file});
    });
  });
}

function runFbx2Vrma(inputPath: string, outputPath: string): Promise<void> {
  // Use the installed CLI (node script) and explicitly point at the Linux FBX2glTF binary
  const projectRoot = process.cwd();
  const converterDir = path.join(projectRoot, 'node_modules', 'fbx2vrma-converter');
  const converterScript = path.join(converterDir, 'fbx2vrma-converter.js');
  const fbx2gltfBin = path.join(converterDir, 'FBX2glTF-linux-x64');

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      converterScript,
      '-i',
      inputPath,
      '-o',
      outputPath,
      '--fbx2gltf',
      fbx2gltfBin,
    ]);

    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`fbx2vrma failed (exit ${code}): ${stderr || 'no stderr'}`));
    });
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({error: 'Method not allowed'});
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fbx2vrma-'));
  try {
    const {file} = await parseForm(req);

    const inputPath = file.filepath;
    const outPath = path.join(tmpDir, `${path.parse(file.originalFilename ?? 'animation.fbx').name}.vrma`);

    await runFbx2Vrma(inputPath, outPath);

    const data = fs.readFileSync(outPath);
    res.setHeader('Content-Type', 'model/gltf-binary');
    res.setHeader('Content-Disposition', 'attachment; filename="animation.vrma"');
    return res.status(200).send(data);
  } catch (e) {
    console.error(e);
    return res.status(500).json({error: e instanceof Error ? e.message : 'Unknown error'});
  } finally {
    try {
      fs.rmSync(tmpDir, {recursive: true, force: true});
    } catch {
      // ignore
    }
  }
}

