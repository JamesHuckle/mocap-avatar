import {useDisclosure, Box} from '@chakra-ui/react';
import {useState, useEffect, useRef} from 'react';
import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {VRM, VRMExpressionPresetName, VRMHumanBoneName, VRMUtils} from '@pixiv/three-vrm';
import * as Kalidokit from 'kalidokit';
import {
  FilesetResolver,
  PoseLandmarker,
  FaceLandmarker,
  HandLandmarker,
  DrawingUtils,
  NormalizedLandmark,
} from '@mediapipe/tasks-vision';
import {useDrag} from '@use-gesture/react';
import {useSpring, animated} from '@react-spring/web';
import ToggleButton from './ToggleButton';
import InfoModal from './InfoModal';

interface HolisticResults {
  poseLandmarks?: NormalizedLandmark[];
  faceLandmarks?: NormalizedLandmark[];
  leftHandLandmarks?: NormalizedLandmark[];
  rightHandLandmarks?: NormalizedLandmark[];
  poseWorldLandmarks?: NormalizedLandmark[];
}

// Import Helper Functions from Kalidokit
const clamp = Kalidokit.Utils.clamp;
const lerp = Kalidokit.Vector.lerp;

export default function KalidoCanvas({currentVrm}: {currentVrm: VRM | null}) {
  const [cameraIsOn, setCameraIsOn] = useState(false);
  const [isDayTheme, setisDayTheme] = useState(true);
  const infoModal = useDisclosure();
  const avatarBgImage = isDayTheme ? '/green-grass-field.jpg' : '/galaxy.jpg';
  const avatarBgImageButton = isDayTheme ? '/galaxy.jpg' : '/green-grass-field.jpg';
  const cameraBgImageButton = cameraIsOn ? '/camera-off.svg' : '/camera-on.svg';
  const isSmallScreen = typeof window !== 'undefined' && window.innerWidth <= 768;

  // Refs for MediaPipe landmarkers
  const poseLandmarkerRef = useRef<PoseLandmarker | null>(null);
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);
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

      const [pose, face, hands] = await Promise.all([
        PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: '/models/pose_landmarker_full.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numPoses: 1,
        }),
        FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: '/models/face_landmarker.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numFaces: 1,
          outputFaceBlendshapes: true,
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
        face.close();
        hands.close();
        return;
      }

      poseLandmarkerRef.current = pose;
      faceLandmarkerRef.current = face;
      handLandmarkerRef.current = hands;
    }

    initMediaPipe();

    return () => {
      isMounted = false;
      poseLandmarkerRef.current?.close();
      faceLandmarkerRef.current?.close();
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
    orbitCamera.position.set(0.0, 0.0, 5);
    // controls
    const canvas = document.getElementById('myAvatar') as HTMLElement;
    const orbitControls = new OrbitControls(orbitCamera, canvas);
    orbitControls.screenSpacePanning = true;
    orbitControls.target.set(0.0, 1.4, 0.0);
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

    // Animate Rotation Helper function
    const rigRotation = (
      name: VRMHumanBoneName,
      rotation = {x: 0, y: 0, z: 0},
      dampener = 1,
      lerpAmount = 0.3,
    ) => {
      const Part = currentVrm.humanoid.getNormalizedBoneNode(name);
      if (!Part) return;
      const euler = new THREE.Euler(
        rotation.x * dampener,
        rotation.y * dampener,
        rotation.z * dampener,
      );
      const quaternion = new THREE.Quaternion().setFromEuler(euler);
      Part.quaternion.slerp(quaternion, lerpAmount);
    };

    // Animate Position Helper Function
    const rigPosition = (
      name: VRMHumanBoneName,
      position = {x: 0, y: 0, z: 0},
      dampener = 1,
      lerpAmount = 0.3,
    ) => {
      const Part = currentVrm.humanoid.getNormalizedBoneNode(name);
      if (!Part) return;
      const vector = new THREE.Vector3(
        position.x * dampener,
        position.y * dampener,
        position.z * dampener,
      );
      Part.position.lerp(vector, lerpAmount);
    };

    let oldLookTarget = new THREE.Euler();
    const rigFace = (riggedFace: Kalidokit.TFace) => {
      rigRotation('neck', riggedFace.head, 0.7);

      const Blendshape = currentVrm.expressionManager;
      if (!Blendshape) return;
      
      const PresetName = VRMExpressionPresetName;

      riggedFace.eye.l = lerp(
        clamp(1 - riggedFace.eye.l, 0, 1),
        Blendshape.getValue(PresetName.Blink) ?? 0,
        0.5,
      ) as number;
      riggedFace.eye.r = lerp(
        clamp(1 - riggedFace.eye.r, 0, 1),
        Blendshape.getValue(PresetName.Blink) ?? 0,
        0.5,
      ) as number;
      riggedFace.eye = Kalidokit.Face.stabilizeBlink(riggedFace.eye, riggedFace.head.y);
      Blendshape.setValue(PresetName.Blink, riggedFace.eye.l);

      Blendshape.setValue(
        PresetName.Ih,
        lerp(riggedFace.mouth.shape.I, Blendshape.getValue(PresetName.Ih) ?? 0, 0.5) as number,
      );
      Blendshape.setValue(
        PresetName.Aa,
        lerp(riggedFace.mouth.shape.A, Blendshape.getValue(PresetName.Aa) ?? 0, 0.5) as number,
      );
      Blendshape.setValue(
        PresetName.Ee,
        lerp(riggedFace.mouth.shape.E, Blendshape.getValue(PresetName.Ee) ?? 0, 0.5) as number,
      );
      Blendshape.setValue(
        PresetName.Oh,
        lerp(riggedFace.mouth.shape.O, Blendshape.getValue(PresetName.Oh) ?? 0, 0.5) as number,
      );
      Blendshape.setValue(
        PresetName.Ou,
        lerp(riggedFace.mouth.shape.U, Blendshape.getValue(PresetName.Ou) ?? 0, 0.5) as number,
      );

      const lookTarget = new THREE.Euler(
        lerp(oldLookTarget.x, riggedFace.pupil.y, 0.4) as number,
        lerp(oldLookTarget.y, riggedFace.pupil.x, 0.4) as number,
        0,
        'XYZ',
      );
      oldLookTarget.copy(lookTarget);
      currentVrm.lookAt?.applier?.lookAt(lookTarget);
    };

    /* VRM Character Animator */
    const animateVRM = (vrm: VRM, results: HolisticResults) => {
      if (!vrm) return;

      let riggedPose, riggedLeftHand, riggedRightHand, riggedFace;
      const faceLandmarks = results.faceLandmarks;
      const pose3DLandmarks = results.poseWorldLandmarks;
      const pose2DLandmarks = results.poseLandmarks;
      // Note: hands may be swapped depending on camera mirroring
      const leftHandLandmarks = results.rightHandLandmarks;
      const rightHandLandmarks = results.leftHandLandmarks;

      // Animate Face
      if (faceLandmarks) {
        riggedFace = Kalidokit.Face.solve(faceLandmarks, {
          runtime: 'mediapipe',
          video: videoRef.current,
        });
        if (riggedFace) {
          rigFace(riggedFace);
        }
      }

      // Animate Pose
      if (pose2DLandmarks && pose3DLandmarks) {
        riggedPose = Kalidokit.Pose.solve(pose3DLandmarks, pose2DLandmarks, {
          runtime: 'mediapipe',
          video: videoRef.current,
        });
        if (riggedPose) {
          rigRotation('hips', riggedPose.Hips.rotation, 0.7);
          rigPosition(
            'hips',
            {
              x: -riggedPose.Hips.position.x,
              y: riggedPose.Hips.position.y + 1,
              z: -riggedPose.Hips.position.z,
            },
            1,
            0.07,
          );

          rigRotation('chest', riggedPose.Spine, 0.25, 0.3);
          rigRotation('spine', riggedPose.Spine, 0.45, 0.3);

          rigRotation('leftUpperArm', riggedPose.LeftUpperArm, 1, 0.3);
          rigRotation('leftLowerArm', riggedPose.LeftLowerArm, 1, 0.3);
          rigRotation('rightUpperArm', riggedPose.RightUpperArm, 1, 0.3);
          rigRotation('rightLowerArm', riggedPose.RightLowerArm, 1, 0.3);

          rigRotation('leftUpperLeg', riggedPose.LeftUpperLeg, 1, 0.3);
          rigRotation('leftLowerLeg', riggedPose.LeftLowerLeg, 1, 0.3);
          rigRotation('rightUpperLeg', riggedPose.RightUpperLeg, 1, 0.3);
          rigRotation('rightLowerLeg', riggedPose.RightLowerLeg, 1, 0.3);
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

      // Draw face landmarks
      if (results.faceLandmarks) {
        drawingUtils.drawConnectors(results.faceLandmarks, FaceLandmarker.FACE_LANDMARKS_TESSELATION, {
          color: '#C0C0C070',
          lineWidth: 1,
        });
        // Draw pupils if available
        if (results.faceLandmarks.length >= 478) {
          drawingUtils.drawLandmarks(
            [results.faceLandmarks[468], results.faceLandmarks[473]],
            {color: '#ffe603', lineWidth: 2}
          );
        }
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
      const faceLandmarker = faceLandmarkerRef.current;
      const handLandmarker = handLandmarkerRef.current;

      if (!poseLandmarker || !faceLandmarker || !handLandmarker) {
        animationFrameRef.current = requestAnimationFrame(detectAndAnimate);
        return;
      }

      // Run all detections
      const poseResult = poseLandmarker.detectForVideo(videoElement, timestamp);
      const faceResult = faceLandmarker.detectForVideo(videoElement, timestamp);
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
        faceLandmarks: faceResult.faceLandmarks[0],
        leftHandLandmarks,
        rightHandLandmarks,
      };

      drawResults(results);
      animateVRM(currentVrm, results);

      animationFrameRef.current = requestAnimationFrame(detectAndAnimate);
    };

    // Start/stop camera based on state
    if (cameraIsOn) {
      const videoElement = videoRef.current;
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
      const videoElement = videoRef.current;
      if (videoElement?.srcObject) {
        const stream = videoElement.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
        videoElement.srcObject = null;
      }
    };
  }, [currentVrm, avatarBgImage, cameraIsOn]);

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
          buttonRightPosition="208px"
          bgImageSrc=""
          bgImageUrl={avatarBgImageButton}
        />
        <ToggleButton
          onClickButton={() => setCameraIsOn(prev => !prev)}
          buttonRightPosition="128px"
          bgImageSrc={cameraBgImageButton}
          bgImageUrl=""
        />
        <canvas id="myAvatar" />
      </Box>
      <InfoModal useDisclosureFn={infoModal} />
    </>
  );
}
