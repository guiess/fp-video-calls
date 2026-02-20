import React, {useState} from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {RTCView} from 'react-native-webrtc';
import type {MediaStream} from 'react-native-webrtc';
import Feather from 'react-native-vector-icons/Feather';
import {Participant} from '../types';

type Props = {
  localStream: MediaStream | null;
  remoteStreams: Map<string, MediaStream>;
  participants: Participant[];
  localUserId: string;
  camEnabled: boolean;
};

export default function VideoGrid({
  localStream,
  remoteStreams,
  participants,
  localUserId,
  camEnabled,
}: Props) {
  const [pinnedId, setPinnedId] = useState<string | null>(null);

  // Fullscreen (pinned) mode — one participant fills the screen
  if (pinnedId) {
    const stream = remoteStreams.get(pinnedId);
    return (
      <View style={styles.grid}>
        {/* Pinned participant fills screen */}
        <View style={styles.tileFullscreen}>
          {stream ? (
            <RTCView
              streamURL={stream.toURL()}
              style={StyleSheet.absoluteFill}
              objectFit="cover"
            />
          ) : (
            <View style={styles.placeholder} />
          )}
          {/* Minimize button */}
          <TouchableOpacity
            style={styles.minimizeBtn}
            onPress={() => setPinnedId(null)}>
            <Text style={styles.minimizeBtnText}>⛶</Text>
          </TouchableOpacity>
        </View>

        {/* Local PiP — only show when camera is on */}
        {localStream && camEnabled && (
          <View style={styles.pip}>
            <RTCView
              streamURL={localStream.toURL()}
              style={StyleSheet.absoluteFill}
              objectFit="cover"
              mirror
            />
          </View>
        )}
      </View>
    );
  }

  // Normal grid mode
  const totalTiles = 1 + remoteStreams.size;
  return (
    <View style={styles.grid}>
      {/* Local stream */}
      {localStream && (
        <View style={[styles.tile, getTileStyle(0, totalTiles)]}>
          <RTCView
            streamURL={localStream.toURL()}
            style={StyleSheet.absoluteFill}
            objectFit="cover"
            mirror
          />
          {!camEnabled && (
            <View style={[StyleSheet.absoluteFill, styles.camOffOverlay]}>
              <Feather name="video-off" size={32} color="#888" />
            </View>
          )}
        </View>
      )}

      {/* Remote streams */}
      {participants.map((p, idx) => {
        const stream = remoteStreams.get(p.userId);
        return (
          <View key={p.userId} style={[styles.tile, getTileStyle(idx + 1, totalTiles)]}>
            {stream ? (
              <RTCView
                streamURL={stream.toURL()}
                style={StyleSheet.absoluteFill}
                objectFit="cover"
              />
            ) : (
              <View style={styles.placeholder} />
            )}
            {/* Fullscreen button */}
            <TouchableOpacity
              style={styles.fullscreenBtn}
              onPress={() => setPinnedId(p.userId)}>
              <Text style={styles.fullscreenBtnText}>⤢</Text>
            </TouchableOpacity>
          </View>
        );
      })}
    </View>
  );
}

function getTileStyle(index: number, total: number) {
  if (total === 1) return styles.tileFullscreen;
  if (total === 2) return styles.tileHalf;
  return styles.tileQuarter;
}

const styles = StyleSheet.create({
  grid: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: '#000',
  },
  tile: {
    backgroundColor: '#1a1a2e',
    overflow: 'hidden',
  },
  tileFullscreen: {
    width: '100%',
    height: '100%',
  },
  tileHalf: {
    width: '100%',
    height: '50%',
  },
  tileQuarter: {
    width: '50%',
    height: '50%',
  },
  placeholder: {
    flex: 1,
    backgroundColor: '#2a2a3e',
  },
  camOffOverlay: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullscreenBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullscreenBtnText: {
    color: '#fff',
    fontSize: 16,
    lineHeight: 20,
  },
  minimizeBtn: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  minimizeBtnText: {
    color: '#fff',
    fontSize: 18,
    lineHeight: 22,
  },
  pip: {
    position: 'absolute',
    bottom: 16,
    right: 16,
    width: 96,
    height: 128,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.3)',
  },
});
