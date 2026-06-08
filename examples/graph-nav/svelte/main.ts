import { mount } from 'svelte';
import Nav from './Nav.svelte';
import '../styles.css';

mount(Nav, { target: document.getElementById('app')! });
