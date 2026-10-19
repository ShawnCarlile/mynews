import 'package:flutter/material.dart';

import 'api.dart';
import 'screens/story_list_screen.dart';

void main() {
  runApp(MyNewsApp(api: ApiClient()));
}

class MyNewsApp extends StatelessWidget {
  const MyNewsApp({super.key, required this.api});

  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    const navy = Color(0xFF1F3A5F);
    return MaterialApp(
      title: 'My News',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: navy, surface: Colors.white),
        scaffoldBackgroundColor: const Color(0xFFF1F5F9),
        appBarTheme: const AppBarTheme(backgroundColor: Color(0xFFF1F5F9), scrolledUnderElevation: 1),
        useMaterial3: true,
      ),
      darkTheme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: navy, brightness: Brightness.dark),
        useMaterial3: true,
      ),
      home: StoryListScreen(api: api),
    );
  }
}
