import {Box} from '@chakra-ui/react';
import Head from 'next/head';
import dynamic from 'next/dynamic';
import {useState, useEffect} from 'react';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {VRMLoaderPlugin, VRMUtils} from '@pixiv/three-vrm';
import {CircularProgressbar} from 'react-circular-progressbar';
import 'react-circular-progressbar/dist/styles.css';

const KalidoCanvas = dynamic(() => import('../components/KalidoCanvas'), {ssr: false});

export default function Home() {
  const [currentVrm, setCurrentVrm] = useState(null);
  const [progress, setProgress] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [vrmUrl, setVrmUrl] = useState<string>(
    'https://gooogle.com'
    // 'https://pixiv.github.io/three-vrm/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm',
  );

  useEffect(() => {
    /* VRM CHARACTER SETUP */
    let objectUrlToRevoke: string | null = null;

    const loader = new GLTFLoader();
    loader.crossOrigin = 'anonymous';
    loader.register(parser => new VRMLoaderPlugin(parser));

    const loadFromUrl = (url: string) => {
      setLoadError(null);
      setProgress(0);

      loader.load(
        url,
        gltf => {
          VRMUtils.removeUnnecessaryJoints(gltf.scene);
          const vrm = gltf.userData.vrm;
          setCurrentVrm(vrm);
        },
        evt => {
          // Some servers don't send Content-Length, so total can be 0.
          if (!evt.total) return;
          setProgress(Math.round(100.0 * (evt.loaded / evt.total)));
        },
        err => {
          console.error(err);
          setLoadError(
            'Failed to load the VRM model. If you are stuck at 0%, the default remote VRM URL may be blocked/unreachable. Try uploading a local .vrm file below.',
          );
        },
      );
    };

    // Load initial VRM
    loadFromUrl(vrmUrl);

    return () => {
      if (objectUrlToRevoke) URL.revokeObjectURL(objectUrlToRevoke);
    };
  }, [vrmUrl]);

  return (
    <>
      <Head>
        <title>VRM mocap</title>
        <meta name="description" content="VRM mocap!" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/website-favicon.png" />
      </Head>
      <main>
        {!currentVrm ? (
          <Box
            background="#dedede"
            bgImage="url('/website-background-cover.png')"
            backgroundSize="contain"
            bgRepeat="no-repeat"
            backgroundPosition="center"
            display="flex"
            justifyContent="center"
            alignItems="flex-end"
            h="100vh"
            w="100%"
          >
            <Box
              display="flex"
              flexDirection="column"
              alignItems="center"
              gap="12px"
              boxSize={['75px', '150px']}
              mb="50px"
            >
              <CircularProgressbar
                value={progress}
                text={`${progress}%`}
                strokeWidth={5}
                styles={{
                  path: {
                    stroke: `rgba(55, 65, 81, ${progress / 100})`,
                    strokeLinecap: 'round',
                  },
                  trail: {
                    stroke: '#dedede',
                    strokeLinecap: 'round',
                  },
                  text: {
                    fill: '#374151',
                    fontSize: '20px',
                    fontWeight: 'bold',
                  },
                }}
              />
              {loadError && (
                <Box
                  width={['280px', '420px']}
                  bg="white"
                  borderRadius="12px"
                  padding="12px"
                  color="#111827"
                  fontSize="14px"
                  boxShadow="md"
                >
                  {loadError}
                </Box>
              )}
              <Box
                width={['280px', '420px']}
                bg="white"
                borderRadius="12px"
                padding="12px"
                color="#111827"
                fontSize="14px"
                boxShadow="md"
              >
                <Box fontWeight="bold" mb="8px">
                  Load your own VRM (local)
                </Box>
                <input
                  type="file"
                  accept=".vrm,model/gltf-binary,model/gltf+json"
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const url = URL.createObjectURL(file);
                    setVrmUrl(url);
                  }}
                />
              </Box>
            </Box>
          </Box>
        ) : (
          <KalidoCanvas currentVrm={currentVrm} />
        )}
      </main>
    </>
  );
}
