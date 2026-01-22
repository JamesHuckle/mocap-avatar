import {useDisclosure, Box} from '@chakra-ui/react';
import {useState, useEffect, useRef, useCallback} from 'react';
import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {VRM, VRMHumanBoneName, VRMUtils} from '@pixiv/three-vrm';
import * as Kalidokit from 'kalidokit';
import {
  FilesetResolver,
  PoseLandmarker,
  HandLandmarker,
  DrawingUtils,
  NormalizedLandmark,
} from '@mediapipe/tasks-vision';
import {useDrag} from '@use-gesture/react';
import {useSpring, animated} from '@react-spring/web';
import ToggleButton from './ToggleButton';
import InfoModal from './InfoModal';
import ServoMapping from './ServoMapping';
import AnimationPlayer from './AnimationPlayer';
import {ServoPositions, JointPositions} from '../lib/vrmServoCalculations';

export interface HolisticResults {
  poseLandmarks?: NormalizedLandmark[];
  leftHandLandmarks?: NormalizedLandmark[];
  rightHandLandmarks?: NormalizedLandmark[];
  poseWorldLandmarks?: NormalizedLandmark[];
}

export default function KalidoCanvas({
  currentVrm,
  onRequestVrmChange,
  onSelectVrmUrl,
}: {
  currentVrm: VRM | null;
  onRequestVrmChange: () => void;
  onSelectVrmUrl: (url: string) => void;
}) {
  const [cameraIsOn, setCameraIsOn] = useState(true);
  const [isDayTheme, setisDayTheme] = useState(true);
  const [showServoPanel, setShowServoPanel] = useState(false);
  const [showAnimationPanel, setShowAnimationPanel] = useState(false);
  const [animationIsPlaying, setAnimationIsPlaying] = useState(false);
  const [debugComparisonMode, setDebugComparisonMode] = useState(false);
  const [showVrmPresetMenu, setShowVrmPresetMenu] = useState(false);
  const [poseData, setPoseData] = useState<{
    poseLandmarks?: NormalizedLandmark[];
    worldLandmarks?: NormalizedLandmark[];
  }>({});
  // Servo positions from animation playback (when animation is active)
  const [animationServoPositions, setAnimationServoPositions] = useState<ServoPositions | null>(null);
  // Joint positions from animation playback (for debug comparison)
  const [animationJointPositions, setAnimationJointPositions] = useState<JointPositions | null>(null);
  
  // Callback for animation player to emit servo positions and joint positions
  const handleAnimationServoUpdate = useCallback((positions: ServoPositions, jointPositions?: JointPositions) => {
    setAnimationServoPositions(positions);
    if (jointPositions) {
      setAnimationJointPositions(jointPositions);
    }
  }, []);
  const infoModal = useDisclosure();
  const avatarBgImage = isDayTheme ? '/green-grass-field.jpg' : '/galaxy.jpg';
  const avatarBgImageButton = isDayTheme ? '/galaxy.jpg' : '/green-grass-field.jpg';
  const cameraBgImageButton = cameraIsOn ? '/camera-off.svg' : '/camera-on.svg';
  const isSmallScreen = typeof window !== 'undefined' && window.innerWidth <= 768;

  // Refs for MediaPipe landmarkers
  const poseLandmarkerRef = useRef<PoseLandmarker | null>(null);
  const handLandmarkerRef = useRef<HandLandmarker | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastTimestampRef = useRef<number>(-1);

  // make video draggable
  const [{x, y}, api] = useSpring(() => ({
    x: 0,
    y: 0,
    config: {mass: 1, tension: 350, friction: 40},
  }));
  const bindDrag = useDrag(({offset}) => {
    api({
      x: offset[0],
      y: offset[1],
    });
  });

  // Initialize MediaPipe Tasks
  useEffect(() => {
    let isMounted = true;

    async function initMediaPipe() {
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
      );

      if (!isMounted) return;

      const [pose, hands] = await Promise.all([
        PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: '/models/pose_landmarker_full.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numPoses: 1,
        }),
        HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: '/models/hand_landmarker.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numHands: 2,
        }),
      ]);

      if (!isMounted) {
        pose.close();
        hands.close();
        return;
      }

      poseLandmarkerRef.current = pose;
      handLandmarkerRef.current = hands;
    }

    initMediaPipe();

    return () => {
      isMounted = false;
      poseLandmarkerRef.current?.close();
      handLandmarkerRef.current?.close();
    };
  }, []);

  // set up three.js once the canvas is loaded
  useEffect(() => {
    if (!currentVrm) return;

    // scene
    const scene = new THREE.Scene();
    // camera
    const orbitCamera = new THREE.PerspectiveCamera(
      35,
      window.innerWidth / window.innerHeight,
      0.1,
      1000,
    );
    orbitCamera.position.set(0.0, 1, 3.6);
    // controls
    const canvas = document.getElementById('myAvatar') as HTMLElement;
    const orbitControls = new OrbitControls(orbitCamera, canvas);
    orbitControls.screenSpacePanning = true;
    orbitControls.target.set(0.0, 0.9, 0.0);
    orbitControls.update();

    // renderer
    const renderer = new THREE.WebGLRenderer({canvas});
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    // light
    const light = new THREE.DirectionalLight(0xffffff);
    light.position.set(1.0, 1.0, 1.0).normalize();
    scene.add(light);
    const textureLoader = new THREE.TextureLoader();
    scene.background = textureLoader.load(avatarBgImage);
    scene.add(currentVrm.scene);
    VRMUtils.rotateVRM0(currentVrm);

    // Main Render Loop
    const clock = new THREE.Clock();
    function animate() {
      requestAnimationFrame(animate);
      if (currentVrm) {
        currentVrm.update(clock.getDelta());
      }
      renderer.render(scene, orbitCamera);
    }
    animate();

    // Animate Rotation Helper function - instant response, no smoothing
    const rigRotation = (
      name: VRMHumanBoneName,
      rotation = {x: 0, y: 0, z: 0},
      dampener = 1,
    ) => {
      const Part = currentVrm.humanoid.getNormalizedBoneNode(name);
      if (!Part) return;
      const euler = new THREE.Euler(
        rotation.x * dampener,
        rotation.y * dampener,
        rotation.z * dampener,
      );
      Part.quaternion.setFromEuler(euler);
    };

    // Animate Position Helper Function - instant response, no smoothing
    const rigPosition = (
      name: VRMHumanBoneName,
      position = {x: 0, y: 0, z: 0},
      dampener = 1,
    ) => {
      const Part = currentVrm.humanoid.getNormalizedBoneNode(name);
      if (!Part) return;
      Part.position.set(
        position.x * dampener,
        position.y * dampener,
        position.z * dampener,
      );
    };

    /* VRM Character Animator */
    const animateVRM = (vrm: VRM, results: HolisticResults) => {
      if (!vrm) return;

      let riggedPose, riggedLeftHand, riggedRightHand;
      const pose3DLandmarks = results.poseWorldLandmarks;
      const pose2DLandmarks = results.poseLandmarks;
      const leftHandLandmarks = results.leftHandLandmarks;
      const rightHandLandmarks = results.rightHandLandmarks;

      // Animate Pose
      if (pose2DLandmarks && pose3DLandmarks) {
        riggedPose = Kalidokit.Pose.solve(pose3DLandmarks, pose2DLandmarks, {
          runtime: 'mediapipe',
          video: videoRef.current,
        });
        if (riggedPose) {
          rigRotation('hips', riggedPose.Hips.rotation, 0.7);
          rigPosition('hips', {
            x: -riggedPose.Hips.position.x,
            y: riggedPose.Hips.position.y + 1,
            z: -riggedPose.Hips.position.z,
          });

          rigRotation('chest', riggedPose.Spine, 0.25);
          rigRotation('spine', riggedPose.Spine, 0.45);

          rigRotation('leftUpperArm', riggedPose.LeftUpperArm);
          rigRotation('leftLowerArm', riggedPose.LeftLowerArm);
          rigRotation('rightUpperArm', riggedPose.RightUpperArm);
          rigRotation('rightLowerArm', riggedPose.RightLowerArm);

          rigRotation('leftUpperLeg', riggedPose.LeftUpperLeg);
          rigRotation('leftLowerLeg', riggedPose.LeftLowerLeg);
          rigRotation('rightUpperLeg', riggedPose.RightUpperLeg);
          rigRotation('rightLowerLeg', riggedPose.RightLowerLeg);
        }
      }

      // Animate Hands
      if (leftHandLandmarks) {
        riggedLeftHand = Kalidokit.Hand.solve(leftHandLandmarks, 'Left');
        if (riggedLeftHand && riggedPose) {
          rigRotation('leftHand', {
            z: riggedPose.LeftHand.z,
            y: riggedLeftHand.LeftWrist.y,
            x: riggedLeftHand.LeftWrist.x,
          });
          rigRotation('leftRingProximal', riggedLeftHand.LeftRingProximal);
          rigRotation('leftRingIntermediate', riggedLeftHand.LeftRingIntermediate);
          rigRotation('leftRingDistal', riggedLeftHand.LeftRingDistal);
          rigRotation('leftIndexProximal', riggedLeftHand.LeftIndexProximal);
          rigRotation('leftIndexIntermediate', riggedLeftHand.LeftIndexIntermediate);
          rigRotation('leftIndexDistal', riggedLeftHand.LeftIndexDistal);
          rigRotation('leftMiddleProximal', riggedLeftHand.LeftMiddleProximal);
          rigRotation('leftMiddleIntermediate', riggedLeftHand.LeftMiddleIntermediate);
          rigRotation('leftMiddleDistal', riggedLeftHand.LeftMiddleDistal);
          rigRotation('leftThumbProximal', riggedLeftHand.LeftThumbProximal);
          rigRotation('leftThumbDistal', riggedLeftHand.LeftThumbDistal);
          rigRotation('leftLittleProximal', riggedLeftHand.LeftLittleProximal);
          rigRotation('leftLittleIntermediate', riggedLeftHand.LeftLittleIntermediate);
          rigRotation('leftLittleDistal', riggedLeftHand.LeftLittleDistal);
        }
      }
      if (rightHandLandmarks) {
        riggedRightHand = Kalidokit.Hand.solve(rightHandLandmarks, 'Right');
        if (riggedRightHand && riggedPose) {
          rigRotation('rightHand', {
            z: riggedPose.RightHand.z,
            y: riggedRightHand.RightWrist.y,
            x: riggedRightHand.RightWrist.x,
          });
          rigRotation('rightRingProximal', riggedRightHand.RightRingProximal);
          rigRotation('rightRingIntermediate', riggedRightHand.RightRingIntermediate);
          rigRotation('rightRingDistal', riggedRightHand.RightRingDistal);
          rigRotation('rightIndexProximal', riggedRightHand.RightIndexProximal);
          rigRotation('rightIndexIntermediate', riggedRightHand.RightIndexIntermediate);
          rigRotation('rightIndexDistal', riggedRightHand.RightIndexDistal);
          rigRotation('rightMiddleProximal', riggedRightHand.RightMiddleProximal);
          rigRotation('rightMiddleIntermediate', riggedRightHand.RightMiddleIntermediate);
          rigRotation('rightMiddleDistal', riggedRightHand.RightMiddleDistal);
          rigRotation('rightThumbProximal', riggedRightHand.RightThumbProximal);
          rigRotation('rightThumbDistal', riggedRightHand.RightThumbDistal);
          rigRotation('rightLittleProximal', riggedRightHand.RightLittleProximal);
          rigRotation('rightLittleIntermediate', riggedRightHand.RightLittleIntermediate);
          rigRotation('rightLittleDistal', riggedRightHand.RightLittleDistal);
        }
      }
    };

    const drawResults = (results: HolisticResults) => {
      const guideCanvas = canvasRef.current;
      const videoElement = videoRef.current;
      if (!guideCanvas || !videoElement) return;

      guideCanvas.width = videoElement.videoWidth;
      guideCanvas.height = videoElement.videoHeight;
      const canvasCtx = guideCanvas.getContext('2d');
      if (!canvasCtx) return;

      canvasCtx.save();
      canvasCtx.clearRect(0, 0, guideCanvas.width, guideCanvas.height);

      const drawingUtils = new DrawingUtils(canvasCtx);

      // Draw pose landmarks
      if (results.poseLandmarks) {
        drawingUtils.drawLandmarks(results.poseLandmarks, {
          color: '#ff0364',
          lineWidth: 2,
        });
        drawingUtils.drawConnectors(results.poseLandmarks, PoseLandmarker.POSE_CONNECTIONS, {
          color: '#00cff7',
          lineWidth: 4,
        });
      }

      // Draw hand landmarks
      if (results.leftHandLandmarks) {
        drawingUtils.drawConnectors(results.leftHandLandmarks, HandLandmarker.HAND_CONNECTIONS, {
          color: '#eb1064',
          lineWidth: 5,
        });
        drawingUtils.drawLandmarks(results.leftHandLandmarks, {
          color: '#00cff7',
          lineWidth: 2,
        });
      }
      if (results.rightHandLandmarks) {
        drawingUtils.drawConnectors(results.rightHandLandmarks, HandLandmarker.HAND_CONNECTIONS, {
          color: '#22c3e3',
          lineWidth: 5,
        });
        drawingUtils.drawLandmarks(results.rightHandLandmarks, {
          color: '#ff0364',
          lineWidth: 2,
        });
      }

      canvasCtx.restore();
    };

    const detectAndAnimate = () => {
      const videoElement = videoRef.current;
      if (!videoElement || videoElement.readyState < 2) {
        animationFrameRef.current = requestAnimationFrame(detectAndAnimate);
        return;
      }

      const timestamp = performance.now();
      // Ensure timestamp is always increasing (required by MediaPipe)
      if (timestamp <= lastTimestampRef.current) {
        animationFrameRef.current = requestAnimationFrame(detectAndAnimate);
        return;
      }
      lastTimestampRef.current = timestamp;

      const poseLandmarker = poseLandmarkerRef.current;
      const handLandmarker = handLandmarkerRef.current;

      if (!poseLandmarker || !handLandmarker) {
        animationFrameRef.current = requestAnimationFrame(detectAndAnimate);
        return;
      }

      // Run detections
      const poseResult = poseLandmarker.detectForVideo(videoElement, timestamp);
      const handResult = handLandmarker.detectForVideo(videoElement, timestamp);

      // Normalize results to match legacy format for Kalidokit
      let leftHandLandmarks: NormalizedLandmark[] | undefined;
      let rightHandLandmarks: NormalizedLandmark[] | undefined;

      handResult.handednesses.forEach((handedness, idx) => {
        // MediaPipe returns mirrored handedness for selfie camera
        const isLeft = handedness[0]?.categoryName === 'Right';
        if (isLeft) {
          leftHandLandmarks = handResult.landmarks[idx];
        } else {
          rightHandLandmarks = handResult.landmarks[idx];
        }
      });

      const results: HolisticResults = {
        poseLandmarks: poseResult.landmarks[0],
        poseWorldLandmarks: poseResult.worldLandmarks[0],
        leftHandLandmarks,
        rightHandLandmarks,
      };

      // Update servo mapping data
      setPoseData({
        poseLandmarks: poseResult.landmarks[0],
        worldLandmarks: poseResult.worldLandmarks[0],
      });

      drawResults(results);
      
      // Only apply mocap if animation player is not active
      if (!animationIsPlaying) {
        animateVRM(currentVrm, results);
      }

      animationFrameRef.current = requestAnimationFrame(detectAndAnimate);
    };

    const videoElement = videoRef.current;

    // Start/stop camera based on state
    if (cameraIsOn) {
      if (videoElement) {
        navigator.mediaDevices
          .getUserMedia({video: {width: 640, height: 480}})
          .then(stream => {
            videoElement.srcObject = stream;
            videoElement.play();
            detectAndAnimate();
          })
          .catch(err => console.error('Camera error:', err));
      }
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (videoElement?.srcObject) {
        const stream = videoElement.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
        videoElement.srcObject = null;
      }
    };
  }, [currentVrm, avatarBgImage, cameraIsOn, animationIsPlaying]);

  return (
    <>
      <Box position="relative" display="flex" flexDir="row">
        {cameraIsOn && (
          <animated.div
            style={{
              x,
              y,
              position: 'relative',
              willChange: 'transform',
              borderRadius: '20px',
              touchAction: 'none',
              cursor: 'grab',
            }}
            {...bindDrag()}
          >
            <Box
              display="flex"
              flexDirection="column"
              position="absolute"
              top="16px"
              left="16px"
              overflow="hidden"
              borderRadius="20px"
              background="#222"
              zIndex="200"
            >
              <video
                ref={videoRef}
                style={{
                  maxWidth: '400px',
                  height: 'auto',
                  transform: 'scale(-1, 1)',
                  borderRadius: '20px',
                  ...(isSmallScreen && {
                    maxWidth: '160px',
                  }),
                }}
                width="1280px"
                height="720px"
                autoPlay
                muted
                playsInline
              />
              <canvas
                ref={canvasRef}
                style={{
                  position: 'absolute',
                  bottom: '0',
                  left: '0',
                  height: 'auto',
                  width: '100%',
                  zIndex: '1',
                  transform: 'scale(-1, 1)',
                }}
              />
            </Box>
          </animated.div>
        )}

        <ToggleButton
          onClickButton={infoModal.isOpen ? infoModal.onClose : infoModal.onOpen}
          buttonRightPosition="48px"
          bgImageSrc="/question.png"
          bgImageUrl=""
        />
        <ToggleButton
          onClickButton={() => setisDayTheme(prev => !prev)}
          buttonRightPosition="288px"
          bgImageSrc=""
          bgImageUrl={avatarBgImageButton}
        />
        <ToggleButton
          onClickButton={() => setCameraIsOn(prev => !prev)}
          buttonRightPosition="208px"
          bgImageSrc={cameraBgImageButton}
          bgImageUrl=""
        />
        <ToggleButton
          onClickButton={() => setShowServoPanel(prev => !prev)}
          buttonRightPosition="128px"
          bgImageSrc="/robot.svg"
          bgImageUrl=""
        />
        <Box
          position="absolute"
          right="448px"
          bottom="48px"
          zIndex="301"
          onMouseEnter={() => setShowVrmPresetMenu(true)}
          onMouseLeave={() => setShowVrmPresetMenu(false)}
        >
          <ToggleButton
            onClickButton={onRequestVrmChange}
            buttonRightPosition="0px"
            buttonBottomPosition="0px"
            bgImageSrc="/person.png"
            bgImageUrl=""
          />
          {showVrmPresetMenu && (
            <Box
              position="absolute"
              bottom="62px"
              right="-36px"
              bg="rgba(15, 15, 25, 0.92)"
              color="white"
              border="1px solid rgba(160, 120, 255, 0.6)"
              borderRadius="12px"
              px="10px"
              py="8px"
              fontSize="11px"
              lineHeight="1.2"
              boxShadow="0 6px 18px rgba(0, 0, 0, 0.35)"
              minW="180px"
            >
              <Box fontWeight="bold" mb="6px">
                Built-in characters
              </Box>
              <Box
                as="button"
                display="block"
                width="100%"
                textAlign="left"
                bg="transparent"
                color="white"
                border="0"
                py="4px"
                px="2px"
                cursor="pointer"
                _hover={{color: 'purple.200'}}
                onClick={() => {
                  onSelectVrmUrl('/assets/latin-dancer.vrm');
                  setShowVrmPresetMenu(false);
                }}
              >
                Latin Dancer
              </Box>
              <Box
                as="button"
                display="block"
                width="100%"
                textAlign="left"
                bg="transparent"
                color="white"
                border="0"
                py="4px"
                px="2px"
                cursor="pointer"
                _hover={{color: 'purple.200'}}
                onClick={() => {
                  onSelectVrmUrl('/assets/AstroNacho.vrm');
                  setShowVrmPresetMenu(false);
                }}
              >
                AstroNacho
              </Box>
              <Box
                as="button"
                display="block"
                width="100%"
                textAlign="left"
                bg="transparent"
                color="white"
                border="0"
                py="4px"
                px="2px"
                cursor="pointer"
                _hover={{color: 'purple.200'}}
                onClick={() => {
                  onSelectVrmUrl('/assets/unitree.vrm');
                  setShowVrmPresetMenu(false);
                }}
              >
                Unitree
              </Box>
              <Box mt="6px" fontSize="10px" color="gray.200">
                Or click the icon to upload your own.
              </Box>
            </Box>
          )}
        </Box>
        <Box
          position="absolute"
          right="448px"
          bottom="104px"
          bg="rgba(15, 15, 25, 0.85)"
          color="white"
          border="1px solid rgba(160, 120, 255, 0.6)"
          borderRadius="12px"
          px="10px"
          py="6px"
          fontSize="11px"
          lineHeight="1.2"
          boxShadow="0 6px 18px rgba(0, 0, 0, 0.35)"
          cursor="pointer"
          userSelect="none"
          onClick={onRequestVrmChange}
        >
          Change character .vrm
        </Box>
        <Box
          position="absolute"
          right="320px"
          bottom="104px"
          bg="rgba(15, 15, 25, 0.85)"
          color="white"
          border="1px solid rgba(160, 120, 255, 0.6)"
          borderRadius="12px"
          px="10px"
          py="6px"
          fontSize="11px"
          lineHeight="1.2"
          boxShadow="0 6px 18px rgba(0, 0, 0, 0.35)"
          cursor="pointer"
          userSelect="none"
          onClick={() => setShowAnimationPanel(prev => !prev)}
        >
          Test built-in dances
          <br />
          or upload your own.
        </Box>
        <ToggleButton
          onClickButton={() => setShowAnimationPanel(prev => !prev)}
          buttonRightPosition="368px"
          bgImageSrc="/dance.svg"
          bgImageUrl=""
        />
        <canvas id="myAvatar" />

        {/* Servo Mapping Panel */}
        {showServoPanel && (
          <Box
            position="absolute"
            top="16px"
            right="16px"
            width="520px"
            maxH="calc(100vh - 32px)"
            overflowY="auto"
            zIndex="100"
            css={{
              '&::-webkit-scrollbar': {width: '6px'},
              '&::-webkit-scrollbar-track': {background: 'transparent'},
              '&::-webkit-scrollbar-thumb': {background: '#4a5568', borderRadius: '3px'},
            }}
          >
            <ServoMapping
              poseLandmarks={poseData.poseLandmarks}
              worldLandmarks={poseData.worldLandmarks}
              animationServoPositions={animationIsPlaying ? animationServoPositions : null}
              debugComparisonMode={debugComparisonMode && animationIsPlaying}
              mediapipePoseForComparison={debugComparisonMode ? poseData.poseLandmarks : undefined}
              fbxJointPositions={debugComparisonMode && animationIsPlaying ? animationJointPositions : null}
            />
          </Box>
        )}

        {/* Animation Player Panel */}
        {showAnimationPanel && (
          <Box
            position="absolute"
            top={cameraIsOn ? '340px' : '16px'}
            left="16px"
            width="380px"
            maxH={cameraIsOn ? 'calc(100vh - 356px)' : 'calc(100vh - 32px)'}
            overflowY="auto"
            zIndex="100"
            transition="all 0.3s ease"
            css={{
              '&::-webkit-scrollbar': {width: '6px'},
              '&::-webkit-scrollbar-track': {background: 'transparent'},
              '&::-webkit-scrollbar-thumb': {background: '#4a5568', borderRadius: '3px'},
            }}
          >
            <AnimationPlayer
              vrm={currentVrm}
              isActive={animationIsPlaying}
              onActiveChange={setAnimationIsPlaying}
              onServoPositionsUpdate={handleAnimationServoUpdate}
              debugComparisonMode={debugComparisonMode}
              onDebugComparisonModeChange={setDebugComparisonMode}
            />
          </Box>
        )}
      </Box>
      <InfoModal useDisclosureFn={infoModal} />
    </>
  );
}
