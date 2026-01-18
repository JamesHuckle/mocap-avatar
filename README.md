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

# then run tonypi pyhton script in wsl2
uv run python3 tonypi_pose_mimic.py