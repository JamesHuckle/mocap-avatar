import {
  Box,
  Text,
  VStack,
  HStack,
  Button,
  Slider,
  SliderTrack,
  SliderFilledTrack,
  SliderThumb,
  Badge,
  Progress,
  Collapse,
  useToast,
  Input,
  SimpleGrid,
} from '@chakra-ui/react';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import * as THREE from 'three';
import {VRM} from '@pixiv/three-vrm';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  VRMAnimationLoaderPlugin,
  VRMAnimation,
  createVRMAnimationClip,
} from '@pixiv/three-vrm-animation';
import {PROCEDURAL_ANIMATIONS, VRMAnimationPlayer, ProceduralAnimation} from '../lib/proceduralAnimations';

type UploadKind = 'vrma' | 'fbx';

function getAnimationEmoji(name: string): string {
  const emojiMap: Record<string, string> = {
    Wave: '👋',
    'Hip Hop': '🕺',
    Groove: '💃',
    Jump: '🦘',
    Disco: '🪩',
    Robot: '🤖',
    Macarena: '🎵',
  };
  return emojiMap[name] || '🎬';
}

function inferUploadKind(fileName: string): UploadKind | null {
  const ext = fileName.split('.').pop()?.toLowerCase();
  if (ext === 'fbx') return 'fbx';
  if (ext === 'vrma' || ext === 'glb') return 'vrma';
  return null;
}

interface AnimationPlayerProps {
  vrm: VRM | null;
  isActive: boolean;
  onActiveChange: (active: boolean) => void;
}

export default function AnimationPlayer({vrm, isActive, onActiveChange}: AnimationPlayerProps) {
  const toast = useToast();

  const presets = useMemo(
    () =>
      PROCEDURAL_ANIMATIONS.map((anim) => ({
        name: anim.name,
        emoji: getAnimationEmoji(anim.name),
        animation: anim,
      })),
    []
  );

  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentAnimation, setCurrentAnimation] = useState<string | null>(null);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loop, setLoop] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [hasLoadedAnimation, setHasLoadedAnimation] = useState(false);

  // Procedural player (built-ins)
  const proceduralRef = useRef<VRMAnimationPlayer | null>(null);

  // VRMA player (official format)
  const gltfLoaderRef = useRef<GLTFLoader | null>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionRef = useRef<THREE.AnimationAction | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number>(0);

  // Initialize loader once
  useEffect(() => {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMAnimationLoaderPlugin(parser));
    gltfLoaderRef.current = loader;
  }, []);

  // Create players when VRM changes
  useEffect(() => {
    if (!vrm) return;
    proceduralRef.current = new VRMAnimationPlayer(vrm);
    proceduralRef.current.setOnUpdate((t, d) => setProgress(d > 0 ? (t / d) * 100 : 0));

    mixerRef.current = new THREE.AnimationMixer(vrm.scene);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      actionRef.current?.stop();
      actionRef.current = null;
      mixerRef.current = null;
      proceduralRef.current?.dispose();
      proceduralRef.current = null;
    };
  }, [vrm]);

  // Keep VRMA action speed in sync
  useEffect(() => {
    if (actionRef.current) actionRef.current.timeScale = playbackSpeed;
  }, [playbackSpeed]);

  // Keep VRMA loop mode in sync
  useEffect(() => {
    if (!actionRef.current) return;
    actionRef.current.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    actionRef.current.clampWhenFinished = !loop;
  }, [loop]);

  const stopAll = useCallback(() => {
    proceduralRef.current?.stop();
    actionRef.current?.stop();
    actionRef.current = null;
    setIsPlaying(false);
    setProgress(0);
    onActiveChange(false);
  }, [onActiveChange]);

  const startMixerLoop = useCallback(() => {
    if (!mixerRef.current || !actionRef.current) return;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    lastTsRef.current = performance.now();

    const tick = () => {
      const now = performance.now();
      const dt = (now - lastTsRef.current) / 1000;
      lastTsRef.current = now;

      if (mixerRef.current && dt > 0 && dt < 1) {
        mixerRef.current.update(dt);
      }

      const a = actionRef.current;
      if (a && duration > 0) {
        setProgress((a.time / duration) * 100);
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
  }, [duration]);

  const playVrmaClip = useCallback(
    (clip: THREE.AnimationClip, name: string) => {
      if (!vrm || !mixerRef.current) return;

      // Stop procedural playback (but do NOT reset pose here; VRMA assumes current VRM rig)
      proceduralRef.current?.stop();

      actionRef.current?.stop();
      const action = mixerRef.current.clipAction(clip);
      action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      action.clampWhenFinished = !loop;
      action.timeScale = playbackSpeed;
      action.reset();
      action.play();
      actionRef.current = action;

      setDuration(clip.duration);
      setCurrentAnimation(name);
      setHasLoadedAnimation(true);
      setIsPlaying(true);
      onActiveChange(true);

      startMixerLoop();
    },
    [loop, onActiveChange, playbackSpeed, startMixerLoop, vrm]
  );

  const loadProcedural = useCallback(
    (animation: ProceduralAnimation) => {
      if (!vrm || !proceduralRef.current) {
        toast({
          title: 'No VRM loaded',
          description: 'Load a VRM model first.',
          status: 'warning',
          duration: 2500,
        });
        return;
      }

      stopAll();

      proceduralRef.current.loadAnimation(animation);
      proceduralRef.current.setLoop(loop);
      proceduralRef.current.setSpeed(playbackSpeed);
      proceduralRef.current.play();

      setDuration(animation.duration);
      setCurrentAnimation(animation.name);
      setHasLoadedAnimation(true);
      setIsPlaying(true);
      onActiveChange(true);

      toast({
        title: `${animation.name} playing`,
        status: 'success',
        duration: 1500,
      });
    },
    [loop, onActiveChange, playbackSpeed, stopAll, toast, vrm]
  );

  const loadVrmaFromUrl = useCallback(
    async (url: string, nameForUi: string) => {
      if (!vrm || !gltfLoaderRef.current) return;

      setIsLoading(true);
      try {
        const loader = gltfLoaderRef.current;
        const gltf = await new Promise<any>((resolve, reject) => {
          loader.load(url, resolve, undefined, reject);
        });

        const vrmAnimation = gltf.userData.vrmAnimations?.[0] as VRMAnimation | undefined;
        if (!vrmAnimation) throw new Error('No VRMA animation found in file.');

        // Type mismatch between @pixiv/three-vrm and @pixiv/three-vrm-animation is internal;
        // runtime is compatible.
        const clip = createVRMAnimationClip(vrmAnimation, vrm as never);
        playVrmaClip(clip, nameForUi);

        toast({title: 'VRMA loaded', status: 'success', duration: 1500});
      } catch (e) {
        console.error(e);
        toast({
          title: 'Failed to load animation',
          description: e instanceof Error ? e.message : 'Unknown error',
          status: 'error',
          duration: 4000,
        });
      } finally {
        setIsLoading(false);
      }
    },
    [playVrmaClip, toast, vrm]
  );

  const convertFbxToVrma = useCallback(async (file: File): Promise<Blob> => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/convert-fbx-to-vrma', {method: 'POST', body: form});
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Conversion failed: ${txt || res.statusText}`);
    }
    return await res.blob();
  }, []);

  const handleUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;

      const kind = inferUploadKind(file.name);
      if (!kind) {
        toast({
          title: 'Unsupported file',
          description: 'Upload .fbx (will be converted), or .vrma/.glb (VRMA).',
          status: 'error',
          duration: 3500,
        });
        return;
      }

      if (!vrm) {
        toast({title: 'No VRM loaded', status: 'warning', duration: 2000});
        return;
      }

      stopAll();

      try {
        setIsLoading(true);

        if (kind === 'fbx') {
          const vrmaBlob = await convertFbxToVrma(file);
          const url = URL.createObjectURL(vrmaBlob);
          await loadVrmaFromUrl(url, file.name.replace(/\.fbx$/i, ''));
          URL.revokeObjectURL(url);
        } else {
          const url = URL.createObjectURL(file);
          await loadVrmaFromUrl(url, file.name.replace(/\.(vrma|glb)$/i, ''));
          URL.revokeObjectURL(url);
        }
      } finally {
        setIsLoading(false);
      }
    },
    [convertFbxToVrma, loadVrmaFromUrl, stopAll, toast, vrm]
  );

  const togglePlay = useCallback(() => {
    if (!hasLoadedAnimation) return;

    // VRMA: pause/resume action
    if (actionRef.current) {
      const a = actionRef.current;
      a.paused = !isPlaying;
      setIsPlaying(!isPlaying);
      onActiveChange(!isPlaying);
      return;
    }

    // Procedural: pause/resume (implemented as stop/play from current time is not supported)
    // Keep it simple: stop on pause, restart on play.
    if (proceduralRef.current) {
      if (isPlaying) {
        proceduralRef.current.pause();
        setIsPlaying(false);
        onActiveChange(false);
      } else {
        proceduralRef.current.play();
        setIsPlaying(true);
        onActiveChange(true);
      }
    }
  }, [hasLoadedAnimation, isPlaying, onActiveChange]);

  return (
    <Box
      bg="rgba(20, 20, 30, 0.95)"
      borderRadius="16px"
      border="1px solid rgba(100, 100, 255, 0.3)"
      p={4}
      boxShadow="0 8px 32px rgba(0, 0, 0, 0.4)"
      backdropFilter="blur(10px)"
    >
      <VStack spacing={4} align="stretch">
        <HStack justify="space-between">
          <HStack>
            <Text fontSize="lg" fontWeight="bold" color="white">
              🎬 Animation Player
            </Text>
            {isPlaying && <Badge colorScheme="green">Playing</Badge>}
            {isLoading && <Badge colorScheme="purple">Working…</Badge>}
          </HStack>
          <Button size="xs" variant="ghost" color="gray.400" onClick={() => setShowAdvanced((v) => !v)}>
            {showAdvanced ? '▲ Less' : '▼ More'}
          </Button>
        </HStack>

        <Box>
          <Text fontSize="sm" color="gray.400" mb={2}>
            📁 Upload (.fbx → converted to VRMA, or .vrma/.glb)
          </Text>
          <Input
            type="file"
            accept=".fbx,.vrma,.glb"
            onChange={handleUpload}
            size="sm"
            bg="rgba(255,255,255,0.05)"
            border="1px dashed rgba(100,100,255,0.5)"
            color="white"
            isDisabled={isLoading}
            _hover={{borderColor: 'purple.400'}}
            sx={{
              '::file-selector-button': {
                bg: 'purple.600',
                color: 'white',
                border: 'none',
                px: 3,
                py: 1,
                mr: 3,
                cursor: 'pointer',
                borderRadius: 'md',
              },
            }}
          />
          <Text fontSize="xs" color="gray.500" mt={1}>
            FBX conversion happens on the local Next.js server via `fbx2vrma-converter`.
          </Text>
        </Box>

        <Box>
          <Text fontSize="sm" color="gray.400" mb={2}>
            🎭 Built-in moves
          </Text>
          <SimpleGrid columns={4} spacing={2}>
            {presets.map((anim) => (
              <Button
                key={anim.name}
                size="sm"
                colorScheme={currentAnimation === anim.animation.name ? 'purple' : 'gray'}
                variant={currentAnimation === anim.animation.name ? 'solid' : 'outline'}
                onClick={() => loadProcedural(anim.animation)}
                h="auto"
                py={2}
                flexDir="column"
              >
                <Text fontSize="xl">{anim.emoji}</Text>
                <Text fontSize="xs" mt={1}>
                  {anim.name}
                </Text>
              </Button>
            ))}
          </SimpleGrid>
        </Box>

        <HStack justify="center" spacing={3}>
          <Button
            size="lg"
            colorScheme={isPlaying ? 'orange' : 'green'}
            onClick={togglePlay}
            isDisabled={!hasLoadedAnimation}
          >
            {isPlaying ? '⏸ Pause' : '▶ Play'}
          </Button>
          <Button size="lg" colorScheme="red" variant="outline" onClick={stopAll} isDisabled={!hasLoadedAnimation}>
            ⏹ Stop
          </Button>
        </HStack>

        {duration > 0 && (
          <Box>
            <HStack justify="space-between" mb={1}>
              <Text fontSize="xs" color="gray.500">
                {currentAnimation ?? 'Animation'}
              </Text>
              <Text fontSize="xs" color="gray.500">
                {((progress / 100) * duration).toFixed(1)}s / {duration.toFixed(1)}s
              </Text>
            </HStack>
            <Progress value={progress} size="sm" colorScheme="purple" borderRadius="full" bg="rgba(255,255,255,0.1)" />
          </Box>
        )}

        <Box>
          <HStack justify="space-between" mb={2}>
            <Text fontSize="sm" color="gray.400">
              Speed: {playbackSpeed.toFixed(1)}x
            </Text>
            <Button size="xs" variant="ghost" color="gray.400" onClick={() => setPlaybackSpeed(1.0)}>
              Reset
            </Button>
          </HStack>
          <Slider value={playbackSpeed} min={0.1} max={2.0} step={0.1} onChange={setPlaybackSpeed}>
            <SliderTrack bg="rgba(255,255,255,0.1)">
              <SliderFilledTrack bg="purple.500" />
            </SliderTrack>
            <SliderThumb boxSize={4} />
          </Slider>
        </Box>

        <HStack justify="space-between">
          <Text fontSize="sm" color="gray.400">
            Loop
          </Text>
          <Button size="sm" colorScheme={loop ? 'green' : 'gray'} variant={loop ? 'solid' : 'outline'} onClick={() => setLoop((v) => !v)}>
            {loop ? '🔁 On' : '➡️ Off'}
          </Button>
        </HStack>

        <Collapse in={showAdvanced}>
          <VStack spacing={2} pt={3} borderTop="1px solid rgba(255,255,255,0.1)">
            <Text fontSize="xs" color="gray.500">
              If you deploy this app (e.g. Vercel), server-side FBX conversion may not be available. In that case,
              convert FBX to VRMA offline and upload the VRMA here.
            </Text>
          </VStack>
        </Collapse>
      </VStack>
    </Box>
  );
}

