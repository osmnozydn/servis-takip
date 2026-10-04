import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from './src/auth/AuthProvider';
import { ChangePasswordScreen } from './src/screens/ChangePasswordScreen';
import { ConsentScreen } from './src/screens/ConsentScreen';
import { DriverHomeScreen } from './src/screens/DriverHomeScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { PassengerHomeScreen } from './src/screens/PassengerHomeScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { colors } from './src/ui/theme';

// Akış: giriş → (ilk girişse) şifre değiştir → (rıza yoksa) KVKK → ana ekran
function Root() {
  const { loading, step, profile } = useAuth();
  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }
  switch (step) {
    case 'login': return <LoginScreen />;
    case 'change_password': return <ChangePasswordScreen />;
    case 'consent': return <ConsentScreen />;
    default:
      if (profile?.role === 'driver') return <DriverHomeScreen />;
      if (profile?.role === 'passenger') return <PassengerHomeScreen />;
      return <HomeScreen />;
  }
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <Root />
        <StatusBar style="dark" />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
