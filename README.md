<!-- PROJECT LOGO -->
<br />
<div align="center">
  <a href="https://github.com/github_username/repo_name">
    <img src="../media/src/images/vrm-mocap-high-resolution-logo.png?raw=true" alt="Logo" width="120">
  </a>

<h3 align="center">VRM Mocap</h3>

  <p align="center">
    A simple project of motion capture and avatar puppeteering!
    <br />
    <a href="https://vrm-mocap.vercel.app/"><strong>Website URL »</strong></a>
    <br />
  </p>
</div>

### Built With

* ![Next JS](https://img.shields.io/badge/Next-black?style=for-the-badge&logo=next.js&logoColor=white)
* ![TypeScript](https://img.shields.io/badge/typescript-%23007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white)
* ![Threejs](https://img.shields.io/badge/threejs-black?style=for-the-badge&logo=three.js&logoColor=white)
* ![Chakra](https://img.shields.io/badge/chakra-%234ED1C5.svg?style=for-the-badge&logo=chakraui&logoColor=white)
* ![Yarn](https://img.shields.io/badge/yarn-%232C8EBB.svg?style=for-the-badge&logo=yarn&logoColor=white)
* [Google Mediapipe](https://developers.google.com/mediapipe) for motion capturing.
* [KalidoKit](https://github.com/yeemachine/kalidokit) and [three-vrm](https://github.com/pixiv/three-vrm) for avatar puppeteering.
* [react-spring](https://www.react-spring.dev/) and [use-gesture](https://use-gesture.netlify.app/) for creating draggable video.

## Feature
* Upon entering the website, a loading screen will indicate the progress of loading the VRM file.
<img width="1280" alt="loading-screen" src="../media/src/images/VRMmocap-loading-screen.png?raw=true">
* You can toggle between two different backgrounds to experience a different feel for the avatar.
<img width="1280" alt="loading-screen" src="../media/src/images/VRMmocap-avatar1.png?raw=true">
* The video is draggable and can be moved around to prevent it from blocking the view.
<img width="1280" alt="loading-screen" src="../media/src/images/VRMmocap-avatar2.png?raw=true">
* There is also an infomation panel of the website features.
<img height="400" alt="loading-screen" src="../media/src/images/VRMmocap-info-panel.png?raw=true">


### My stuff

`uv run python3 scripts/servo_client.py --robot ws://192.168.0.104:8766`

# get webcam working in powershell to pass to wsl2
winget install usbipd
usbipd list                          # Find your camera BUSID

usbipd bind --busid 1-6          # Bind the camera
usbipd attach --wsl --busid 1-6  # Attach to WSL2

# unbind
usbipd unbind --busid 1-6
usbipd detach --busid 1-6

# then run tonypi pyhton script in wsl2
uv run python3 tonypi_pose_mimic.py --source /dev/video0

## TonyPi Servo Positions (Paired by Joint)

| Servo | Name | Movement A | Position A | Standing | Movement B | Position B |
|-------|------|------------|------------|----------|------------|------------|
| 7 | L Shoulder Side | Arm raised up/out | 125 | **800** | Arm down/back | 900 |
| 15 | R Shoulder Side | Arm down/back | 100 | **200** | Arm raised up/out | 875 |
| 8 | L Shoulder Fwd | Arm forward | 330 | **725** | Arm back | 968 |
| 16 | R Shoulder Fwd | Arm back | 31 | **275** | Arm forward | 787 |
| 6 | L Elbow | Fully bent | 125 | **575** | Fully extended | 930 |
| 14 | R Elbow | Fully extended | 450 | **425** | Fully bent | 177 |
| 13 | L Hip Side | Leg out to side | 249 | **500** | Leg inward | 624 |
| 5 | R Hip Side | Leg inward | 375 | **500** | Leg out to side | 750 |
| 12 | L Hip Front | Leg forward/bent | 141 | **400** | Leg back | 875 |
| 4 | R Hip Front | Leg back | 125 | **600** | Leg forward/bent | 857 |
| 11 | L Knee | Fully bent (squat) | 40 | **500** | Straight | 1000 |
| 3 | R Knee | Straight | 0 | **500** | Fully bent (squat) | 960 |
| 9 | L Ankle | Min | 366 | **500** | Max | 570 |
| 1 | R Ankle | Min | 395 | **500** | Max | 642 |
| 10 | L (Unknown) | Min | 140 | **610** | Max | 950 |
| 2 | R (Unknown) | Min | 50 | **390** | Max | 819 |
| 17 | Head Pan | Left | 300 | **500** | Right | 760 |
| 18 | Head Tilt | Up | 240 | **500** | Down | 500 |

