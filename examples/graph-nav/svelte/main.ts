import { mount } from 'svelte';
import Nav from './Nav.svelte';
import '../styles.css';
import '../inspector-loader';

mount(Nav, { target: document.getElementById('app')! });
