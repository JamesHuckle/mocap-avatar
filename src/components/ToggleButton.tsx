import styles from './ToggleButton.module.css';
import {Box, Image} from '@chakra-ui/react';

interface ToggleButtonProps {
  onClickButton: () => void;
  buttonRightPosition: string;
  buttonBottomPosition?: string;
  bgImageSrc: string;
  bgImageUrl: string;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

const ToggleButton: React.FC<ToggleButtonProps> = ({
  onClickButton,
  buttonRightPosition,
  buttonBottomPosition = '48px',
  bgImageSrc,
  bgImageUrl,
  onMouseEnter,
  onMouseLeave,
}) => {
  return (
    <button
      className={styles.c_button}
      style={{
        right: `${buttonRightPosition}`,
        bottom: `${buttonBottomPosition}`,
        backgroundImage: `url(${bgImageUrl})`,
      }}
      onClick={onClickButton}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {bgImageSrc && (
        <Box p="5px">
          <Image src={bgImageSrc} w="30px" h="30px" alt="" />
        </Box>
      )}
    </button>
  );
};

export default ToggleButton;
