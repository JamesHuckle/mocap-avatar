import {Box, Button} from '@chakra-ui/react';
import Head from 'next/head';
import dynamic from 'next/dynamic';
import {useState, useEffect, useRef} from 'react';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {VRMLoaderPlugin, VRMUtils} from '@pixiv/three-vrm';
import {CircularProgressbar} from 'react-circular-progressbar';
import 'react-circular-progressbar/dist/styles.css';

const KalidoCanvas = dynamic(() => import('../components/KalidoCanvas'), {ssr: false});

export default function Home() {
  const [currentVrm, setCurrentVrm] = useState(null);
  const [progress, setProgress] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [vrmUrl, setVrmUrl] = useState<string>('/assets/unitree.vrm');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  const openVrmFilePicker = () => {
    fileInputRef.current?.click();
  };

  const handleVrmFileSelection = (file: File | null | undefined) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
    }
    objectUrlRef.current = url;
    setVrmUrl(url);
  };

  const handleBuiltInVrmSelection = (url: string) => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setVrmUrl(url);
  };

  useEffect(() => {
    /* VRM CHARACTER SETUP */
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

  }, [vrmUrl]);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  return (
    <>
      <Head>
        <title>VRM mocap</title>
        <meta name="description" content="VRM mocap!" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/website-favicon.png" />
      </Head>
      <main>
        <input
          ref={fileInputRef}
          type="file"
          accept=".vrm,model/gltf-binary,model/gltf+json"
          onChange={e => {
            const file = e.target.files?.[0];
            handleVrmFileSelection(file);
            e.currentTarget.value = '';
          }}
          style={{display: 'none'}}
        />
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
                <Button
                  size="sm"
                  colorScheme="purple"
                  onClick={openVrmFilePicker}
                  width="100%"
                >
                  Choose VRM file
                </Button>
                <Box fontSize="12px" color="gray.600" mt="6px">
                  Supported: .vrm
                </Box>
              </Box>
            </Box>
          </Box>
        ) : (
          <KalidoCanvas
            currentVrm={currentVrm}
            onRequestVrmChange={openVrmFilePicker}
            onSelectVrmUrl={handleBuiltInVrmSelection}
          />
        )}
      </main>
    </>
  );
}
